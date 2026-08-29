import { afterEach, describe, expect, it, vi } from 'vitest';

import { PHOTO_UPLOAD_FILES_EVENT, PhotoUpload, type PhotoUploadFilesEvent } from '../src/index.js';

function mount(attrs: Record<string, string> = {}): PhotoUpload {
  const el = document.createElement('photo-upload');
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  document.body.appendChild(el);
  return el;
}

function innerInput(el: PhotoUpload): HTMLInputElement {
  return el.shadowRoot!.querySelector('input') as HTMLInputElement;
}

function setInputFiles(el: PhotoUpload, files: File[]): void {
  const input = innerInput(el);
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function dropFiles(el: PhotoUpload, files: File[]): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files } });
  el.dispatchEvent(event);
}

function collectEvents(target: EventTarget): PhotoUploadFilesEvent[] {
  const events: PhotoUploadFilesEvent[] = [];
  target.addEventListener(PHOTO_UPLOAD_FILES_EVENT, (e) => {
    events.push(e as PhotoUploadFilesEvent);
  });
  return events;
}

const png = new File(['png'], 'photo.png', { type: 'image/png' });
const jpg = new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' });
const txt = new File(['txt'], 'notes.txt', { type: 'text/plain' });

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('registration', () => {
  it('defines the photo-upload element', () => {
    expect(customElements.get('photo-upload')).toBe(PhotoUpload);
    expect(mount()).toBeInstanceOf(PhotoUpload);
  });

  it('re-importing the module does not throw on double definition', async () => {
    vi.resetModules(); // force the module (and its define guard) to re-execute
    await expect(import('../src/index.js')).resolves.toBeDefined();
    expect(customElements.get('photo-upload')).toBe(PhotoUpload);
  });
});

describe('rendering', () => {
  it('renders a dropzone and a hidden file input in shadow DOM', () => {
    const el = mount();
    expect(el.shadowRoot!.querySelector('.dropzone')).not.toBeNull();
    const input = innerInput(el);
    expect(input).not.toBeNull();
    expect(input.type).toBe('file');
  });

  it('is focusable and exposed as a button when connected', () => {
    const el = mount();
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('button');
  });
});

describe('accept / multiple forwarding', () => {
  it('forwards the accept attribute to the inner input', () => {
    const el = mount({ accept: 'image/*' });
    expect(innerInput(el).getAttribute('accept')).toBe('image/*');
    el.removeAttribute('accept');
    expect(innerInput(el).hasAttribute('accept')).toBe(false);
  });

  it('forwards the multiple attribute to the inner input', () => {
    const el = mount({ multiple: '' });
    expect(innerInput(el).hasAttribute('multiple')).toBe(true);
    el.removeAttribute('multiple');
    expect(innerInput(el).hasAttribute('multiple')).toBe(false);
  });

  it('reflects accept and multiple as properties', () => {
    const el = mount();
    el.accept = 'image/png';
    el.multiple = true;
    expect(el.getAttribute('accept')).toBe('image/png');
    expect(el.hasAttribute('multiple')).toBe(true);
    expect(el.accept).toBe('image/png');
    expect(el.multiple).toBe(true);
    el.accept = '';
    el.multiple = false;
    expect(el.hasAttribute('accept')).toBe(false);
    expect(el.hasAttribute('multiple')).toBe(false);
  });
});

describe('file selection via input', () => {
  it('fires photo-upload:files with the selected files on change', () => {
    const el = mount({ multiple: '' });
    const events = collectEvents(el);
    setInputFiles(el, [png, jpg]);
    innerInput(el).dispatchEvent(new Event('change'));
    expect(events).toHaveLength(1);
    expect(events[0].detail.files).toEqual([png, jpg]);
  });

  it('the event bubbles and crosses the shadow boundary (composed)', () => {
    const el = mount();
    const documentEvents = collectEvents(document);
    setInputFiles(el, [png]);
    innerInput(el).dispatchEvent(new Event('change'));
    expect(documentEvents).toHaveLength(1);
    expect(documentEvents[0].bubbles).toBe(true);
    expect(documentEvents[0].composed).toBe(true);
  });

  it('does not fire when the change carries no files', () => {
    const el = mount();
    const events = collectEvents(el);
    setInputFiles(el, []);
    innerInput(el).dispatchEvent(new Event('change'));
    expect(events).toHaveLength(0);
  });
});

describe('drag and drop', () => {
  it('fires photo-upload:files with dropped files', () => {
    const el = mount({ multiple: '' });
    const events = collectEvents(el);
    dropFiles(el, [png, jpg]);
    expect(events).toHaveLength(1);
    expect(events[0].detail.files).toEqual([png, jpg]);
  });

  it('filters dropped files against a mime wildcard accept', () => {
    const el = mount({ multiple: '', accept: 'image/*' });
    const events = collectEvents(el);
    dropFiles(el, [png, txt, jpg]);
    expect(events[0].detail.files).toEqual([png, jpg]);
  });

  it('filters dropped files against extension tokens', () => {
    const el = mount({ multiple: '', accept: '.png,.gif' });
    const events = collectEvents(el);
    dropFiles(el, [png, jpg]);
    expect(events[0].detail.files).toEqual([png]);
  });

  it('does not fire when no dropped file matches accept', () => {
    const el = mount({ multiple: '', accept: 'image/*' });
    const events = collectEvents(el);
    dropFiles(el, [txt]);
    expect(events).toHaveLength(0);
  });

  it('keeps only the first file when multiple is not set', () => {
    const el = mount();
    const events = collectEvents(el);
    dropFiles(el, [png, jpg]);
    expect(events[0].detail.files).toEqual([png]);
  });

  it('toggles the dragover state on dragover/dragleave/drop', () => {
    const el = mount();
    el.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(el.hasAttribute('dragover')).toBe(true);
    el.dispatchEvent(new Event('dragleave'));
    expect(el.hasAttribute('dragover')).toBe(false);

    el.dispatchEvent(new Event('dragenter', { cancelable: true }));
    expect(el.hasAttribute('dragover')).toBe(true);
    dropFiles(el, [png]);
    expect(el.hasAttribute('dragover')).toBe(false);
  });
});

describe('picker activation', () => {
  it('opens the picker on click', () => {
    const el = mount();
    const click = vi.spyOn(innerInput(el), 'click').mockImplementation(() => {});
    el.dispatchEvent(new Event('click', { bubbles: true }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each(['Enter', ' '])('opens the picker on %j key', (key) => {
    const el = mount();
    const click = vi.spyOn(innerInput(el), 'click').mockImplementation(() => {});
    el.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    const el = mount();
    const click = vi.spyOn(innerInput(el), 'click').mockImplementation(() => {});
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(click).not.toHaveBeenCalled();
  });
});
