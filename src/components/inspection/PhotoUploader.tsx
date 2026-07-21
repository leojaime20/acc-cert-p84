import { useEffect, useId, useState } from 'react';
import {
  discardInspectionPhotoAttempt,
  PhotoUploadError,
  removeInspectionPhoto,
  uploadInspectionPhoto,
} from '../../services/photoService';
import type { InspectionPhoto } from '../../types/inspection';
import type { UserProfile } from '../../types/user';

interface PhotoUploaderProps {
  inspectionId: string;
  itemId: string | null;
  photos: InspectionPhoto[];
  user: UserProfile;
  editable: boolean;
  onAdded: (photo: InspectionPhoto) => void;
  onRemoved: (photoId: string) => void;
}

export function PhotoUploader({
  inspectionId,
  itemId,
  photos,
  user,
  editable,
  onAdded,
  onRemoved,
}: PhotoUploaderProps) {
  const cameraInputId = useId();
  const deviceInputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [retryPhotoId, setRetryPhotoId] = useState<string>();
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(nextFile ? URL.createObjectURL(nextFile) : '');
    setRetryPhotoId(undefined);
    setProgress(0);
    setError('');
  }

  function uploadErrorMessage(uploadError: unknown) {
    if (!(uploadError instanceof PhotoUploadError)) {
      return 'Unexpected error while uploading the photo. Try again.';
    }
    if (uploadError.stage === 'validation' || uploadError.stage === 'compression') {
      return uploadError.message;
    }
    if (uploadError.stage === 'dimensions') {
      return 'The browser could not prepare this image. Try another photo or convert it to JPEG.';
    }
    if (uploadError.stage === 'storage-upload') {
      return `The photo was prepared, but the upload failed. Check your connection and try again. (${uploadError.code})`;
    }
    if (uploadError.stage === 'download-url') {
      return `The photo was uploaded, but could not be opened. Try again. (${uploadError.code})`;
    }
    return `Unable to register the photo. Try again. (${uploadError.code})`;
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const photo = await uploadInspectionPhoto(
        inspectionId,
        itemId,
        file,
        caption,
        user,
        setProgress,
        retryPhotoId,
      );
      onAdded(photo);
      selectFile(null);
      setCaption('');
      setProgress(0);
      setRetryPhotoId(undefined);
    } catch (uploadError) {
      console.error('Photo upload failed', uploadError);
      if (uploadError instanceof PhotoUploadError) setRetryPhotoId(uploadError.photoId);
      setError(uploadErrorMessage(uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function remove(photo: InspectionPhoto) {
    setError('');
    try {
      await removeInspectionPhoto(inspectionId, photo);
      onRemoved(photo.id);
    } catch {
      setError('Unable to remove the photo.');
    }
  }

  async function cancelSelection() {
    if (retryPhotoId) {
      try {
        await discardInspectionPhotoAttempt(inspectionId, itemId, retryPhotoId);
      } catch (discardError) {
        console.error('Unable to discard the upload attempt', discardError);
        setError('Unable to discard the incomplete upload. Try again.');
        return;
      }
    }
    selectFile(null);
  }

  return (
    <div className="photo-section">
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((photo) => (
            <figure className="photo-card" key={photo.id}>
              {photo.downloadUrl && !brokenImages.has(photo.id) ? (
                <img
                  src={photo.downloadUrl}
                  alt={photo.caption || 'Inspection evidence'}
                  onError={() => setBrokenImages((current) => new Set(current).add(photo.id))}
                />
              ) : (
                <div className="photo-unavailable" role="status">
                  <strong>
                    {photo.uploadStatus === 'failed'
                      ? 'Incomplete upload'
                      : photo.uploadStatus === 'pending'
                        ? 'Upload pending'
                        : 'Image unavailable'}
                  </strong>
                  <small>
                    {photo.errorStage
                      ? `Stage: ${photo.errorStage}${photo.errorCode ? ` · ${photo.errorCode}` : ''}`
                      : 'The inspection is still available.'}
                  </small>
                </div>
              )}
              {(photo.caption || editable) && (
                <figcaption>
                  <span>{photo.caption || 'No caption'}</span>
                  {editable && (
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => void remove(photo)}
                    >
                      Remove
                    </button>
                  )}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {editable && !file && (
        <div className="photo-source-actions">
          <input
            className="visually-hidden"
            id={cameraInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) => selectFile(event.target.files?.[0] || null)}
          />
          <label className="camera-button" htmlFor={cameraInputId}>
            <span aria-hidden="true">◉</span> Take photo
          </label>

          <input
            className="visually-hidden"
            id={deviceInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) => selectFile(event.target.files?.[0] || null)}
          />
          <label className="camera-button device-photo-button" htmlFor={deviceInputId}>
            <span aria-hidden="true">▧</span> Choose from device
          </label>
        </div>
      )}

      {file && (
        <div className="photo-preview">
          <img src={preview} alt="New photo preview" />
          <label>
            Caption (optional)
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Describe the evidence"
            />
          </label>
          {uploading && (
            <div className="upload-progress" aria-live="polite">
              <span style={{ width: `${progress}%` }} />
              <small>Uploading: {progress}%</small>
            </div>
          )}
          <div className="photo-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={uploading}
              onClick={() => void cancelSelection()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary compact-button"
              disabled={uploading}
              onClick={() => void upload()}
            >
              {uploading ? 'Uploading…' : retryPhotoId ? 'Try again' : 'Use photo'}
            </button>
          </div>
        </div>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
