import { useParams } from 'react-router-dom';

export function InspectionPage() {
  const { inspectionId } = useParams();
  return (
    <section>
      <p className="eyebrow">Inspeção</p>
      <h1>{inspectionId}</h1>
      <div className="empty-state">
        O preenchimento do checklist será implementado na fase operacional.
      </div>
    </section>
  );
}
