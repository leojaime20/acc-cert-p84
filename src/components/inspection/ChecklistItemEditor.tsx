import { useCallback, useEffect, useRef, useState } from 'react';
import { updateInspectionItem } from '../../services/inspectionService';
import type {
  ChecklistItemStatus,
  InspectionItem,
  InspectionPhoto,
  InspectionSummary,
} from '../../types/inspection';
import type { UserProfile } from '../../types/user';
import { PhotoUploader } from './PhotoUploader';

const statuses: Array<{ value: ChecklistItemStatus; label: string; short: string }> = [
  { value: 'approved', label: 'Aprovado', short: 'Aprovado' },
  { value: 'partially_approved', label: 'Parcialmente aprovado', short: 'Parcial' },
  { value: 'rejected', label: 'Reprovado', short: 'Reprovado' },
  { value: 'not_applicable', label: 'Não aplicável', short: 'N/A' },
  { value: 'not_started', label: 'Não verificado', short: 'Pendente' },
];

interface ChecklistItemEditorProps {
  inspectionId: string;
  item: InspectionItem;
  photos: InspectionPhoto[];
  user: UserProfile;
  editable: boolean;
  onSaved: (item: InspectionItem, summary: InspectionSummary) => void;
  onPhotoAdded: (photo: InspectionPhoto) => void;
  onPhotoRemoved: (photoId: string) => void;
}

export function ChecklistItemEditor({
  inspectionId,
  item,
  photos,
  user,
  editable,
  onSaved,
  onPhotoAdded,
  onPhotoRemoved,
}: ChecklistItemEditorProps) {
  const [status, setStatus] = useState(item.status);
  const [comment, setComment] = useState(item.comment || '');
  const [recommendation, setRecommendation] = useState(item.recommendation || '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const textChanged = useRef(false);

  const save = useCallback(
    async (nextStatus = status, nextComment = comment, nextRecommendation = recommendation) => {
      if (!editable) return;
      setSaveState('saving');
      try {
        const summary = await updateInspectionItem(inspectionId, item.id, {
          status: nextStatus,
          comment: nextComment.trim(),
          recommendation: nextRecommendation.trim(),
        });
        onSaved(
          {
            ...item,
            status: nextStatus,
            comment: nextComment.trim(),
            recommendation: nextRecommendation.trim(),
          },
          summary,
        );
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    },
    [comment, editable, inspectionId, item, onSaved, recommendation, status],
  );

  useEffect(() => {
    if (!textChanged.current || !editable) return;
    const timer = window.setTimeout(() => {
      textChanged.current = false;
      void save(status, comment, recommendation);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [comment, editable, recommendation, save, status]);

  const statusLabel = statuses.find((option) => option.value === status)?.short || 'Pendente';
  const needsComment = status === 'rejected' || status === 'partially_approved';
  const needsRecommendation = status === 'rejected';

  return (
    <details className={`checklist-editor item-${status}`}>
      <summary>
        <span className="item-number">{item.itemNumber}</span>
        <span className="item-summary-copy">
          <strong>{item.code}</strong>
          <span>{item.description}</span>
        </span>
        <span className={`status-chip status-${status}`}>{statusLabel}</span>
      </summary>
      <div className="checklist-editor-body">
        {item.verificationInstruction && item.verificationInstruction !== item.description && (
          <div className="verification-note">
            <strong>Como verificar</strong>
            <p>{item.verificationInstruction}</p>
          </div>
        )}
        <fieldset disabled={!editable}>
          <legend>
            Status do item {item.required && <span className="required-mark">Obrigatório</span>}
          </legend>
          <div className="status-options">
            {statuses.slice(0, 4).map((option) => (
              <button
                type="button"
                key={option.value}
                className={`status-option option-${option.value} ${status === option.value ? 'selected' : ''}`}
                aria-pressed={status === option.value}
                onClick={() => {
                  setStatus(option.value);
                  void save(option.value, comment, recommendation);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          Comentário {needsComment && <span className="required-text">obrigatório</span>}
          <textarea
            value={comment}
            disabled={!editable}
            rows={3}
            placeholder={
              status === 'not_applicable' ? 'Informe a justificativa' : 'Registre uma observação'
            }
            onChange={(event) => {
              textChanged.current = true;
              setComment(event.target.value);
            }}
          />
        </label>
        <label>
          Recomendação ou ação corretiva{' '}
          {needsRecommendation && <span className="required-text">obrigatória</span>}
          <textarea
            value={recommendation}
            disabled={!editable}
            rows={3}
            placeholder="Descreva a ação recomendada"
            onChange={(event) => {
              textChanged.current = true;
              setRecommendation(event.target.value);
            }}
          />
        </label>
        <div className={`save-indicator save-${saveState}`} aria-live="polite">
          {saveState === 'saving' && 'Salvando…'}
          {saveState === 'saved' && '✓ Salvo automaticamente'}
          {saveState === 'error' && 'Erro ao salvar. Altere o campo para tentar novamente.'}
        </div>
        <div className="item-photos-heading">
          <strong>Evidências fotográficas</strong>
          {item.photoRequired && <span className="required-mark">Obrigatória</span>}
        </div>
        <PhotoUploader
          inspectionId={inspectionId}
          itemId={item.id}
          photos={photos}
          user={user}
          editable={editable}
          onAdded={onPhotoAdded}
          onRemoved={onPhotoRemoved}
        />
      </div>
    </details>
  );
}
