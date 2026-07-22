import { useEffect, useId, useRef, useState } from 'react';
import {
  discardInspectionPhotoAttempt,
  PhotoUploadError,
  removeInspectionPhoto,
  uploadInspectionPhoto,
  validatePhotoFile,
} from '../../services/photoService';
import type { InspectionPhoto } from '../../types/inspection';
import type { UserProfile } from '../../types/user';

const MAX_QUEUED_PHOTOS = 10;

type QueuedPhotoStatus = 'ready' | 'uploading' | 'failed';

interface QueuedPhoto {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
  status: QueuedPhotoStatus;
  progress: number;
  error: string;
  retryPhotoId?: string;
}

interface PhotoUploaderProps {
  inspectionId: string;
  itemId: string | null;
  queueId: string;
  photos: InspectionPhoto[];
  user: UserProfile;
  editable: boolean;
  onAdded: (photo: InspectionPhoto) => void;
  onRemoved: (photoId: string) => void;
  onPendingChange?: (queueId: string, pending: number, uploading: boolean) => void;
}

function queuedPhotoId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function pluralPhotos(count: number) {
  return count === 1 ? 'photo' : 'photos';
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

export function PhotoUploader({
  inspectionId,
  itemId,
  queueId,
  photos,
  user,
  editable,
  onAdded,
  onRemoved,
  onPendingChange,
}: PhotoUploaderProps) {
  const cameraInputId = useId();
  const deviceInputId = useId();
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ total: 0, processed: 0, current: 0 });
  const [removingQueueId, setRemovingQueueId] = useState<string>();
  const [error, setError] = useState('');
  const [brokenImages, setBrokenImages] = useState<Set<string>>(() => new Set());
  const queueRef = useRef(queue);
  const pendingChangeRef = useRef(onPendingChange);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    pendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    onPendingChange?.(queueId, queue.length, uploading);
  }, [onPendingChange, queue.length, queueId, uploading]);

  useEffect(
    () => () => {
      queueRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      pendingChangeRef.current?.(queueId, 0, false);
    },
    [queueId],
  );

  function addFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const availableSlots = Math.max(0, MAX_QUEUED_PHOTOS - queue.length);
    const selectedFiles = Array.from(fileList);
    const accepted: QueuedPhoto[] = [];
    const messages: string[] = [];

    for (const file of selectedFiles.slice(0, availableSlots)) {
      try {
        validatePhotoFile(file);
        accepted.push({
          id: queuedPhotoId(),
          file,
          previewUrl: URL.createObjectURL(file),
          caption: '',
          status: 'ready',
          progress: 0,
          error: '',
        });
      } catch (selectionError) {
        messages.push(
          `${file.name}: ${
            selectionError instanceof Error ? selectionError.message : 'Unsupported image.'
          }`,
        );
      }
    }

    if (selectedFiles.length > availableSlots) {
      messages.push(`Each batch can contain up to ${MAX_QUEUED_PHOTOS} photos.`);
    }
    if (accepted.length) setQueue((current) => [...current, ...accepted]);
    setError(messages.join(' '));
  }

  function updateQueuedPhoto(photoId: string, update: Partial<QueuedPhoto>) {
    setQueue((current) =>
      current.map((photo) => (photo.id === photoId ? { ...photo, ...update } : photo)),
    );
  }

  async function removeQueuedPhoto(photo: QueuedPhoto) {
    setRemovingQueueId(photo.id);
    setError('');
    try {
      if (photo.retryPhotoId) {
        await discardInspectionPhotoAttempt(inspectionId, itemId, photo.retryPhotoId);
      }
      URL.revokeObjectURL(photo.previewUrl);
      setQueue((current) => current.filter((currentPhoto) => currentPhoto.id !== photo.id));
    } catch {
      setError('Unable to discard the incomplete upload. Try again.');
    } finally {
      setRemovingQueueId(undefined);
    }
  }

  async function uploadBatch() {
    const candidates = queue.filter((photo) => photo.status !== 'uploading');
    if (!candidates.length) return;

    setUploading(true);
    setError('');
    setBatchProgress({ total: candidates.length, processed: 0, current: 0 });
    let failures = 0;

    for (const [index, queuedPhoto] of candidates.entries()) {
      updateQueuedPhoto(queuedPhoto.id, { status: 'uploading', progress: 0, error: '' });
      setBatchProgress({ total: candidates.length, processed: index, current: 0 });
      try {
        const photo = await uploadInspectionPhoto(
          inspectionId,
          itemId,
          queuedPhoto.file,
          queuedPhoto.caption,
          user,
          (progress) => {
            updateQueuedPhoto(queuedPhoto.id, { progress });
            setBatchProgress({ total: candidates.length, processed: index, current: progress });
          },
          queuedPhoto.retryPhotoId,
        );
        URL.revokeObjectURL(queuedPhoto.previewUrl);
        setQueue((current) => current.filter((currentPhoto) => currentPhoto.id !== queuedPhoto.id));
        onAdded(photo);
      } catch (uploadError) {
        failures += 1;
        updateQueuedPhoto(queuedPhoto.id, {
          status: 'failed',
          progress: 0,
          error: uploadErrorMessage(uploadError),
          retryPhotoId:
            uploadError instanceof PhotoUploadError
              ? uploadError.photoId || queuedPhoto.retryPhotoId
              : queuedPhoto.retryPhotoId,
        });
      } finally {
        setBatchProgress({ total: candidates.length, processed: index + 1, current: 0 });
      }
    }

    if (failures) {
      setError(
        `${failures} ${pluralPhotos(failures)} could not be uploaded. Review and retry the failed photos.`,
      );
    }
    setUploading(false);
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

  const failedCount = queue.filter((photo) => photo.status === 'failed').length;
  const totalBatchProgress = batchProgress.total
    ? Math.round(
        ((batchProgress.processed * 100 + batchProgress.current) / (batchProgress.total * 100)) *
          100,
      )
    : 0;

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
                  loading="lazy"
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
                      disabled={uploading}
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

      {editable && !uploading && queue.length < MAX_QUEUED_PHOTOS && (
        <div className="photo-source-actions">
          <input
            className="visually-hidden"
            id={cameraInputId}
            type="file"
            aria-label="Take photo"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            disabled={uploading}
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) => addFiles(event.target.files)}
          />
          <label className="camera-button" htmlFor={cameraInputId}>
            <span aria-hidden="true">◉</span> Take photo
          </label>

          <input
            className="visually-hidden"
            id={deviceInputId}
            type="file"
            aria-label="Choose from device"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={uploading}
            onClick={(event) => {
              event.currentTarget.value = '';
            }}
            onChange={(event) => addFiles(event.target.files)}
          />
          <label className="camera-button device-photo-button" htmlFor={deviceInputId}>
            <span aria-hidden="true">▧</span> Choose from device
          </label>
        </div>
      )}

      {queue.length > 0 && (
        <div className="photo-queue" aria-label="Photos awaiting upload">
          <div className="photo-queue-heading">
            <div>
              <strong>
                {queue.length} {pluralPhotos(queue.length)} awaiting upload
              </strong>
              <small>Add captions or remove photos before confirming the batch.</small>
            </div>
            <span>{MAX_QUEUED_PHOTOS - queue.length} slots available</span>
          </div>

          <div className="queued-photo-grid">
            {queue.map((photo, index) => (
              <figure className={`queued-photo-card queue-${photo.status}`} key={photo.id}>
                <img src={photo.previewUrl} alt={`Selected photo ${index + 1}`} loading="lazy" />
                <figcaption>
                  <label>
                    Caption (optional)
                    <input
                      aria-label={`Caption for selected photo ${index + 1}`}
                      value={photo.caption}
                      disabled={uploading}
                      onChange={(event) =>
                        updateQueuedPhoto(photo.id, { caption: event.target.value })
                      }
                      placeholder="Add caption"
                    />
                  </label>
                  {photo.status === 'uploading' && (
                    <div className="upload-progress" aria-live="polite">
                      <span style={{ width: `${photo.progress}%` }} />
                      <small>Uploading: {photo.progress}%</small>
                    </div>
                  )}
                  {photo.status === 'failed' && (
                    <small className="field-error" role="alert">
                      {photo.error}
                    </small>
                  )}
                  <button
                    type="button"
                    className="button button-outline compact-button queued-photo-remove"
                    disabled={uploading || removingQueueId === photo.id}
                    onClick={() => void removeQueuedPhoto(photo)}
                  >
                    {removingQueueId === photo.id ? 'Removing…' : 'Remove'}
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>

          {uploading && (
            <div className="batch-upload-progress" aria-live="polite">
              <div className="upload-progress">
                <span style={{ width: `${totalBatchProgress}%` }} />
                <small>Batch progress: {totalBatchProgress}%</small>
              </div>
              <small>
                Processing {Math.min(batchProgress.processed + 1, batchProgress.total)} of{' '}
                {batchProgress.total}
              </small>
            </div>
          )}

          <button
            type="button"
            className="button button-primary photo-batch-button"
            disabled={uploading || Boolean(removingQueueId)}
            onClick={() => void uploadBatch()}
          >
            {uploading
              ? 'Uploading batch…'
              : failedCount === queue.length
                ? `Retry ${failedCount} failed ${pluralPhotos(failedCount)}`
                : `Upload ${queue.length} ${pluralPhotos(queue.length)}`}
          </button>
        </div>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
