import { Link, useParams } from 'react-router-dom';

export function AreaPage() {
  const { projectId, areaId } = useParams();
  return (
    <section>
      <p className="eyebrow">Área/Zona</p>
      <h1>{areaId}</h1>
      <div className="action-card">
        <h2>Nova inspeção</h2>
        <p>O checklist vinculado à área será copiado para um novo rascunho.</p>
        <button className="button button-primary" disabled>
          Iniciar inspeção
        </button>
        <small>A criação de inspeções será habilitada na próxima entrega funcional.</small>
      </div>
      <Link className="text-link" to={`/projects`}>
        ← Voltar às áreas de {projectId}
      </Link>
    </section>
  );
}
