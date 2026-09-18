import Link from "fumadocs-core/link";
import * as lucide from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

type IconName = keyof typeof lucide;

function resolveIcon(icon: ReactNode | string | undefined): ReactNode {
  if (!icon) return null;
  if (typeof icon !== "string") return icon;
  const Icon = (lucide as unknown as Record<string, ComponentType<{ className?: string }>>)[
    icon as IconName
  ];
  if (!Icon) return null;
  return <Icon className="size-4" />;
}

export function Cards({
  className = "",
  children,
  ...props
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      {...props}
      className={`docs-cards not-prose grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}
    >
      {children}
    </div>
  );
}

export function Card({
  icon,
  title,
  description,
  href,
  children,
  className = "",
}: {
  icon?: ReactNode | string;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  children?: ReactNode;
  className?: string;
}) {
  const resolved = resolveIcon(icon);
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {resolved && (
            <span className="docs-card-icon inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              {resolved}
            </span>
          )}
          <h3 className="docs-card-title m-0 text-[15px] font-medium leading-tight text-foreground">
            {title}
          </h3>
        </div>
        {href && (
          <ArrowRight className="docs-card-arrow mt-1.5 size-3.5 shrink-0 text-muted-foreground transition-transform" />
        )}
      </div>
      {description && (
        <p className="m-0 mt-2 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
      )}
    </>
  );

  const cls = `docs-card group block rounded-lg border border-border bg-card p-4 transition-colors ${
    href ? "hover:border-foreground/30" : ""
  } ${className}`;

  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}
