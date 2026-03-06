import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  width?: string;
  render: (row: T, index: number) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
}

export function DataTable<T>({ columns, data, emptyMessage = '暂无数据' }: DataTableProps<T>) {
  const gridCols = columns.map((c) => c.width ?? '1fr').join(' ');

  return (
    <div className="bg-claw-card rounded-xl border border-claw-border overflow-hidden">
      <div
        className="grid items-center px-5 py-3 bg-claw-input"
        style={{ gridTemplateColumns: gridCols }}
      >
        {columns.map((col) => (
          <span key={col.key} className="text-claw-muted text-xs font-semibold">
            {col.header}
          </span>
        ))}
      </div>

      {data.length === 0 ? (
        <div className="px-5 py-10 text-center text-claw-muted text-sm">{emptyMessage}</div>
      ) : (
        data.map((row, i) => (
          <div
            key={i}
            className="grid items-center px-5 py-3.5 border-t border-claw-border hover:bg-claw-card-hover transition-colors"
            style={{ gridTemplateColumns: gridCols }}
          >
            {columns.map((col) => (
              <div key={col.key}>{col.render(row, i)}</div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
