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
      return 'Falha inesperada ao enviar a fotografia. Tente novamente.';
    }
    if (uploadError.stage === 'validation' || uploadError.stage === 'compression') {
      return uploadError.message;
    }
    if (uploadError.stage === 'dimensions') {
      return 'O navegador não conseguiu preparar esta imagem. Tente outra fotografia ou converta-a para JPEG.';
    }
    if (uploadError.stage === 'storage-upload') {
      return `A fotografia foi preparada, mas o envio falhou. Verifique a conexão e tente novamente. (${uploadError.code})`;
    }
    if (uploadError.stage === 'download-url') {
      return `A fotografia foi enviada, mas não pôde ser aberta. Tente novamente. (${uploadError.code})`;
    }
    return `Não foi possível registrar a fotografia. Tente novamente. (${uploadError.code})`;
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
      console.error('Falha no upload de fotografia', uploadError);
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
      setError('Não foi possível remover a fotografia.');
    }
  }

  async function cancelSelection() {
    if (retryPhotoId) {
      try {
        await discardInspectionPhotoAttempt(inspectionId, itemId, retryPhotoId);
      } catch (discardError) {
        console.error('Falha ao descartar tentativa de upload', discardError);
        setError('Não foi possível descartar o envio incompleto. Tente novamente.');
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
                  alt={photo.caption || 'Evidência da inspeção'}
                  onError={() => setBrokenImages((current) => new Set(current).add(photo.id))}
                />
              ) : (
                <div className="photo-unavailable" role="status">
                  <strong>
                    {photo.uploadStatus === 'failed'
                      ? 'Envio incompleto'
                      : photo.uploadStatus === 'pending'
                        ? 'Envio pendente'
                        : 'Imagem indisponível'}
                  </strong>
                  <small>
                    {photo.errorStage
                      ? `Etapa: ${photo.errorStage}${photo.errorCode ? ` · ${photo.errorCode}` : ''}`
                      : 'A inspeção continua disponível.'}
                  </small>
                </div>
              )}
              {(photo.caption || editable) && (
                <figcaption>
                  <span>{photo.caption || 'Sem legenda'}</span>
                  {editable && (
                    <button
                      type="button"
                      className="photo-remove"
                      onClick={() => void remove(photo)}
                    >
                      Remover
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
            <span aria-hidden="true">◉</span> Tirar foto
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
            <span aria-hidden="true">▧</span> Escolher do dispositivo
          </label>
        </div>
      )}

      {file && (
        <div className="photo-preview">
          <img src={preview} alt="Pré-visualização da nova fotografia" />
          <label>
            Legenda (opcional)
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Descreva a evidência"
            />
          </label>
          {uploading && (
            <div className="upload-progress" aria-live="polite">
              <span style={{ width: `${progress}%` }} />
              <small>Enviando: {progress}%</small>
            </div>
          )}
          <div className="photo-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={uploading}
              onClick={() => void cancelSelection()}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button button-primary compact-button"
              disabled={uploading}
              onClick={() => void upload()}
            >
              {uploading ? 'Enviando…' : retryPhotoId ? 'Tentar novamente' : 'Usar fotografia'}
            </button>
          </div>
        </div>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
