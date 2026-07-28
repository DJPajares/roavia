import { Button, ExperienceState, TrustNotice } from "@roavia/ui";

export function WorkspacePlaceholder({
  eyebrow,
  title,
}: Readonly<{ eyebrow: string; title: string }>) {
  return (
    <section className="workspace-placeholder">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="workspace-placeholder__lede">
        This route is ready for its product flow. The shared shell, state patterns, and trust
        language are already in place.
      </p>
      <div className="workspace-placeholder__actions">
        <Button>View foundation guidance</Button>
        <Button tone="quiet">Review accessible states</Button>
      </div>
      <ExperienceState
        detail="This intentional empty state gives each new flow a clear, actionable starting point."
        state="empty"
        title="No content has been added here yet"
      />
      <TrustNotice>
        When live data arrives, each time-sensitive detail will identify its source and freshness.
      </TrustNotice>
    </section>
  );
}
