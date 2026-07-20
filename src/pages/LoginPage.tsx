import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../features/auth/useAuth';
import { isFirebaseConfigured } from '../lib/firebase/app';

const loginSchema = z.object({
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(6, 'A senha deve possuir ao menos 6 caracteres.'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to="/projects" replace />;

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-heading">
          <span className="brand-mark brand-mark-large">ACC</span>
          <div>
            <h1>Inspeção de obra</h1>
            <p>P84 • Certificação diária de áreas e evidências.</p>
          </div>
        </div>
        {!isFirebaseConfigured && (
          <div className="notice notice-warning">Configure o Firebase para habilitar o acesso.</div>
        )}
        <form
          onSubmit={handleSubmit(async (values) => {
            setError('');
            try {
              await login(values.email, values.password);
            } catch {
              setError('Não foi possível entrar. Confira o e-mail, a senha e seu acesso.');
            }
          })}
        >
          <label>
            E-mail
            <input type="email" autoComplete="email" {...register('email')} />
            {errors.email && <small className="field-error">{errors.email.message}</small>}
          </label>
          <label>
            Senha
            <input type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <small className="field-error">{errors.password.message}</small>}
          </label>
          {error && <div className="notice notice-error">{error}</div>}
          <button
            className="button button-primary"
            disabled={isSubmitting || !isFirebaseConfigured}
          >
            {isSubmitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}
