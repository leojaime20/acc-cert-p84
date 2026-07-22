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
  { value: 'approved', label: 'Approved', short: 'Approved' },
  { value: 'partially_approved', label: 'Partially approved', short: 'Partial' },
  { value: 'rejected', label: 'Rejected', short: 'Rejected' },
  { value: 'not_applicable', label: 'Not applicable', short: 'N/A' },
  { value: 'not_started', label: 'Not verified', short: 'Pending' },
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
  onPhotoQueueChange?: (queueId: string, pending: number, uploading: boolean) => void;
  onRegisterFlush?: (itemId: string, flush: (() => Promise<void>) | null) => void;
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
  onPhotoQueueChange,
  onRegisterFlush,
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

  const flushPendingText = useCallback(async () => {
    if (!textChanged.current || !editable) return;
    textChanged.current = false;
    await save(status, comment, recommendation);
  }, [comment, editable, recommendation, save, status]);

  useEffect(() => {
    onRegisterFlush?.(item.id, flushPendingText);
    return () => onRegisterFlush?.(item.id, null);
  }, [flushPendingText, item.id, onRegisterFlush]);

  const statusLabel = statuses.find((option) => option.value === status)?.short || 'Pending';
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
            <strong>How to verify</strong>
            <p>{item.verificationInstruction}</p>
          </div>
        )}
        <fieldset disabled={!editable}>
          <legend>
            Item status {item.required && <span className="required-mark">Required</span>}
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
          Comment {needsComment && <span className="required-text">required</span>}
          <textarea
            value={comment}
            disabled={!editable}
            rows={3}
            placeholder={
              status === 'not_applicable' ? 'Provide a justification' : 'Add an observation'
            }
            onChange={(event) => {
              textChanged.current = true;
              setComment(event.target.value);
            }}
          />
        </label>
        <label>
          Recommendation or corrective action{' '}
          {needsRecommendation && <span className="required-text">required</span>}
          <textarea
            value={recommendation}
            disabled={!editable}
            rows={3}
            placeholder="Describe the recommended action"
            onChange={(event) => {
              textChanged.current = true;
              setRecommendation(event.target.value);
            }}
          />
        </label>
        <div className={`save-indicator save-${saveState}`} aria-live="polite">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && '✓ Saved automatically'}
          {saveState === 'error' && 'Save error. Change the field to try again.'}
        </div>
        <div className="item-photos-heading">
          <strong>Photo evidence</strong>
          {item.photoRequired && <span className="required-mark">Required</span>}
        </div>
        <PhotoUploader
          inspectionId={inspectionId}
          itemId={item.id}
          queueId={`item:${item.id}`}
          photos={photos}
          user={user}
          editable={editable}
          onAdded={onPhotoAdded}
          onRemoved={onPhotoRemoved}
          onPendingChange={onPhotoQueueChange}
        />
      </div>
    </details>
  );
}
