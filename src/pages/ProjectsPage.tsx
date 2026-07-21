import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { listAreas, listProjects } from '../services/projectService';
import type { Area, Project } from '../types/project';

export function ProjectsPage() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [queryText, setQueryText] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    void listProjects(profile.projectIds, profile.role === 'admin')
      .then(async (nextProjects) => {
        setProjects(nextProjects);
        if (nextProjects[0]) setAreas(await listAreas(nextProjects[0].id));
      })
      .catch(() => setError('Unable to load the areas.'))
      .finally(() => setLoading(false));
  }, [profile]);

  const locations = [...new Set(areas.map((area) => area.location))].sort();
  const normalizedQuery = queryText.trim().toLocaleLowerCase();
  const filteredAreas = areas.filter(
    (area) =>
      (!location || area.location === location) &&
      (!normalizedQuery ||
        area.code.toLocaleLowerCase().includes(normalizedQuery) ||
        area.name.toLocaleLowerCase().includes(normalizedQuery)),
  );

  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Active project</p>
          <h1>{projects[0]?.name || 'Projects'}</h1>
        </div>
        <span className="count-pill">{areas.length} areas</span>
      </div>
      <div className="filter-panel">
        <input
          aria-label="Search area"
          placeholder="Search code or description"
          value={queryText}
          onChange={(event) => setQueryText(event.target.value)}
        />
        <select
          aria-label="Filter by deck"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">All decks</option>
          {locations.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      {loading && <p>Loading areas…</p>}
      {error && <div className="notice notice-error">{error}</div>}
      {!loading && !error && (
        <div className="card-grid">
          {filteredAreas.map((area) => (
            <Link
              className="area-card"
              key={area.id}
              to={`/projects/${area.projectId}/areas/${area.id}`}
            >
              <div className="area-card-heading">
                <strong>{area.code}</strong>
                <span className="badge">{area.checklistTemplateId}</span>
              </div>
              <h2>{area.name}</h2>
              <p>{area.location}</p>
            </Link>
          ))}
          {filteredAreas.length === 0 && (
            <div className="empty-state">No areas found.</div>
          )}
        </div>
      )}
    </section>
  );
}
