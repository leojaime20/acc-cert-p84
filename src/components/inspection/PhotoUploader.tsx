import { useEffect, useId, useState } from 'react';
import { removeInspectionPhoto, uploadInspectionPhoto } from '../../services/photoService';
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
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(nextFile ? URL.createObjectURL(nextFile) : '');
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
      );
      onAdded(photo);
      selectFile(null);
      setCaption('');
      setProgress(0);
    } catch {
      setError('Falha ao enviar a fotografia. Tente novamente.');
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

  return (
    <div className="photo-section">
      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((photo) => (
            <figure className="photo-card" key={photo.id}>
              <img src={photo.downloadUrl} alt={photo.caption || 'Evidência da inspeção'} />
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
        <>
          <input
            className="visually-hidden"
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => selectFile(event.target.files?.[0] || null)}
          />
          <label className="camera-button" htmlFor={inputId}>
            <span aria-hidden="true">＋</span> Tirar ou adicionar foto
          </label>
        </>
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
              onClick={() => selectFile(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="button button-primary compact-button"
              disabled={uploading}
              onClick={() => void upload()}
            >
              {uploading ? 'Enviando…' : 'Usar fotografia'}
            </button>
          </div>
        </div>
      )}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
