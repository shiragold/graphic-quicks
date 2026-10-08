/**
 * `<photo-upload>` — a zero-dependency file-intake dropzone.
 *
 * - Click anywhere (or focus + Enter/Space) to open the file picker.
 * - Drag-and-drop with a visual dragover state (`dragover` attribute on the
 *   host, styleable from outside via `photo-upload[dragover]`).
 * - `accept` and `multiple` are reflected attributes forwarded to the inner
 *   `<input type="file">`; dropped files are filtered against `accept`.
 * - Every selection or drop fires a composed, bubbling
 *   `CustomEvent('photo-upload:files')` with `detail: { files: File[] }`.
 *
 * Customization: `icon` / `label` / `hint` slots for content, and CSS custom
 * properties (see the stylesheet below) for colors and sizing.
 */

export interface PhotoUploadFilesDetail {
  files: File[];
}

export type PhotoUploadFilesEvent = CustomEvent<PhotoUploadFilesDetail>;

/** Event type fired on every file selection or drop. */
export const PHOTO_UPLOAD_FILES_EVENT = 'photo-upload:files';

function parseAccept(accept: string): string[] {
  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}

function fileMatchesAccept(file: File, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

const TEMPLATE = `
<style>
  :host {
    display: block;
    box-sizing: border-box;
    cursor: pointer;
    text-align: center;
    color: var(--photo-upload-color, inherit);
    background: var(--photo-upload-background, transparent);
    border: var(--photo-upload-border-width, 2px)
      var(--photo-upload-border-style, dashed)
      var(--photo-upload-border-color, #999);
    border-radius: var(--photo-upload-radius, 12px);
    padding: var(--photo-upload-padding, 40px 20px);
    transition: background 0.2s, border-color 0.2s;
  }
  :host(:hover),
  :host([dragover]) {
    border-color: var(--photo-upload-border-color-active, #555);
    background: var(--photo-upload-background-active, rgba(0, 0, 0, 0.05));
  }
  :host(:focus-visible) {
    outline: 2px solid var(--photo-upload-border-color-active, #555);
    outline-offset: 2px;
  }
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--photo-upload-gap, 8px);
    /* Keep hit-testing on the host so click/drag targets never flicker. */
    pointer-events: none;
  }
  .icon {
    font-size: var(--photo-upload-icon-size, 40px);
    line-height: 1;
  }
  .hint {
    font-size: 0.85em;
    opacity: 0.7;
  }
  input {
    display: none;
  }
</style>
<div class="dropzone" part="dropzone">
  <span class="icon" part="icon" aria-hidden="true"><slot name="icon">+</slot></span>
  <span class="label" part="label"><slot name="label"><strong>Drop photos here</strong> or click to browse</slot></span>
  <span class="hint" part="hint"><slot name="hint"></slot></span>
</div>
<input type="file">
`;

export class PhotoUpload extends HTMLElement {
  static observedAttributes = ['accept', 'multiple'];

  readonly #input: HTMLInputElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this.#input = root.querySelector('input') as HTMLInputElement;

    // The input's own click (from .click()) is composed and would bubble back
    // to the host click handler, re-opening the picker in a loop.
    this.#input.addEventListener('click', (event) => event.stopPropagation());

    this.#input.addEventListener('change', () => {
      const files = Array.from(this.#input.files ?? []);
      // Allow re-selecting the same file(s) later.
      this.#input.value = '';
      if (files.length > 0) this.#emitFiles(files);
    });

    this.addEventListener('click', () => this.#input.click());
    this.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.#input.click();
      }
    });

    for (const type of ['dragenter', 'dragover'] as const) {
      this.addEventListener(type, (event) => {
        event.preventDefault();
        this.toggleAttribute('dragover', true);
      });
    }
    this.addEventListener('dragleave', () => {
      this.removeAttribute('dragover');
    });
    this.addEventListener('drop', (event) => {
      event.preventDefault();
      this.removeAttribute('dragover');
      const dataTransfer = (event as DragEvent).dataTransfer;
      if (!dataTransfer) return;
      const tokens = parseAccept(this.accept);
      let files = Array.from(dataTransfer.files ?? []).filter((file) =>
        fileMatchesAccept(file, tokens)
      );
      if (!this.multiple) files = files.slice(0, 1);
      if (files.length > 0) this.#emitFiles(files);
    });
  }

  connectedCallback(): void {
    if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button');
  }

  attributeChangedCallback(name: string, _oldValue: string | null, value: string | null): void {
    if (name === 'accept') {
      if (value === null) this.#input.removeAttribute('accept');
      else this.#input.setAttribute('accept', value);
    } else if (name === 'multiple') {
      this.#input.toggleAttribute('multiple', value !== null);
    }
  }

  get accept(): string {
    return this.getAttribute('accept') ?? '';
  }

  set accept(value: string) {
    if (value) this.setAttribute('accept', value);
    else this.removeAttribute('accept');
  }

  get multiple(): boolean {
    return this.hasAttribute('multiple');
  }

  set multiple(value: boolean) {
    this.toggleAttribute('multiple', value);
  }

  #emitFiles(files: File[]): void {
    this.dispatchEvent(
      new CustomEvent<PhotoUploadFilesDetail>(PHOTO_UPLOAD_FILES_EVENT, {
        detail: { files },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'photo-upload': PhotoUpload;
  }
  interface HTMLElementEventMap {
    'photo-upload:files': PhotoUploadFilesEvent;
  }
}
