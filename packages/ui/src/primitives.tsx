import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export const roaviaTokens = {
  color: ["canvas", "surface", "ink", "muted", "accent", "danger", "warning", "success"],
  elevation: ["flat", "raised", "floating"],
  motion: ["instant", "calm", "expressive"],
  radius: ["control", "panel", "sheet"],
  spacing: ["compact", "comfortable", "generous"],
  typography: ["display", "body", "label", "numeric"],
} as const;

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "accent" | "quiet";
}

export function Button({ className, tone = "accent", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={classNames("roavia-button", `roavia-button--${tone}`, className)}
      type={type}
      {...props}
    />
  );
}

export type ExperienceState = "loading" | "empty" | "error" | "stale" | "offline" | "permission";

const stateSymbols: Record<ExperienceState, string> = {
  empty: "○",
  error: "!",
  loading: "◌",
  offline: "↯",
  permission: "⌁",
  stale: "◷",
};

export interface ExperienceStateProps extends HTMLAttributes<HTMLElement> {
  action?: ReactNode;
  detail: string;
  state: ExperienceState;
  title: string;
}

export function ExperienceState({
  action,
  className,
  detail,
  state,
  title,
  ...props
}: ExperienceStateProps) {
  const role = state === "error" ? "alert" : "status";

  return (
    <section
      className={classNames("roavia-state", `roavia-state--${state}`, className)}
      role={role}
      {...props}
    >
      <span aria-hidden="true" className="roavia-state__symbol">
        {stateSymbols[state]}
      </span>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
        {action ? <div className="roavia-state__action">{action}</div> : null}
      </div>
    </section>
  );
}

export interface TrustNoticeProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  label?: string;
}

export function TrustNotice({
  children,
  className,
  label = "Trust note",
  ...props
}: TrustNoticeProps) {
  return (
    <aside className={classNames("roavia-trust-notice", className)} {...props}>
      <span aria-hidden="true">◈</span>
      <div>
        <p className="roavia-trust-notice__label">{label}</p>
        <p>{children}</p>
      </div>
    </aside>
  );
}
