import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RankTableProps {
  title: string;
  columns: { key: string; label: string; align?: "right" }[];
  rows: Record<string, ReactNode>[];
  emptyText: string;
}

export function RankTable({ title, columns, rows, emptyText }: RankTableProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 font-display text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[12px] text-fg-muted">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={cn("px-2 py-1.5 font-medium", column.align === "right" && "text-right")}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-line">
                  {columns.map((column) => (
                    <td key={column.key} className={cn("px-2 py-1.5", column.align === "right" && "num text-right")}>
                      {row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
