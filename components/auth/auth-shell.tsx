import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  context: string;
  title: string;
  description: string;
  highlights?: string[];
};

export function AuthShell({ children, context, title, description, highlights = [] }: AuthShellProps) {
  return (
    <main id="conteudo" className="auth-shell">
      <div className="auth-grid">
        <aside className="auth-story" aria-label="Espaço Alfa">
          <Link href="/" className="auth-brand" aria-label="Espaço Alfa — voltar ao início">
            <span className="auth-brand-mark" aria-hidden="true">A</span>
            <span>
              <strong>Espaço Alfa</strong>
              <small>Cuidado, estilo e identidade</small>
            </span>
          </Link>

          <div className="auth-story-copy">
            <p className="eyebrow">Experiência Alfa</p>
            <h2>Seu cuidado começa antes mesmo de sentar na cadeira.</h2>
            <p>
              Uma experiência digital pensada para tornar cada visita mais simples,
              segura e pontual.
            </p>
          </div>

          {highlights.length ? (
            <ul className="auth-highlights" aria-label="Benefícios">
              {highlights.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="auth-story-foot">Porto Velho · Rondônia</p>
        </aside>

        <section className="auth-form-side">
          <div className="auth-mobile-brand">
            <Link href="/" className="auth-brand" aria-label="Espaço Alfa — voltar ao início">
              <span className="auth-brand-mark" aria-hidden="true">A</span>
              <span><strong>Espaço Alfa</strong><small>Cuidado para todos os cabelos</small></span>
            </Link>
          </div>

          <div className="auth-card animate-fade-up">
            <header className="auth-card-header">
              <p className="eyebrow">{context}</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </header>
            {children}
          </div>

          <Link href="/" className="auth-home-link">
            <span aria-hidden="true">←</span> Voltar para o início
          </Link>
        </section>
      </div>
    </main>
  );
}

export function AuthFeedback({ message, success = false, id = "auth-feedback" }: { message: string; success?: boolean; id?: string }) {
  if (!message) return null;
  return (
    <div id={id} role={success ? "status" : "alert"} aria-live="polite" className={`auth-feedback ${success ? "auth-feedback-success" : "auth-feedback-error"}`}>
      <span aria-hidden="true">{success ? "✓" : "!"}</span>
      <p>{message}</p>
    </div>
  );
}

export function AuthDivider({ children }: { children: ReactNode }) {
  return <div className="auth-divider"><span>{children}</span></div>;
}
