export {
  PhotoUpload,
  PHOTO_UPLOAD_FILES_EVENT,
  type PhotoUploadFilesDetail,
  type PhotoUploadFilesEvent,
} from './photo-upload.js';

import { PhotoUpload } from './photo-upload.js';

// Idempotent side-effect registration: buildless apps import this module
// purely for the side effect, and multiple imports must not throw.
if (!customElements.get('photo-upload')) {
  customElements.define('photo-upload', PhotoUpload);
}
