export const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function Money({ cents, className = "" }: { cents: number; className?: string }) { return <span className={`mono ${className}`}>{money(cents)}</span>; }
