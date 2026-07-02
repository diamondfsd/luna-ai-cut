import { Fragment, type ReactNode } from 'react'
import './table.css'

export interface Column<T> {
  key: string
  label: string
  width?: string | number
  render?: (row: T, index: number) => ReactNode
  className?: string
  headerClassName?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor: (row: T, index: number) => string
  emptyLabel?: string
  className?: string
  rowClassName?: (row: T, index: number) => string | undefined
  expandContent?: (row: T, index: number) => ReactNode
  expandedKeys?: Set<string>
  onExpandToggle?: (expandKey: string) => void
  rowToExpandKey?: (row: T, index: number) => string
  maxHeight?: number | string
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  emptyLabel = '暂无数据',
  className = '',
  rowClassName,
  expandContent,
  expandedKeys,
  onExpandToggle,
  rowToExpandKey,
  maxHeight,
}: TableProps<T>) {
  return (
    <div className="ui-table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className={`ui-table ${className}`}>
        <thead>
          <tr>
            {expandContent && <th key="__expand" style={{ width: 32 }} />}
            {columns.map((col) => (
              <th key={col.key} className={col.headerClassName} style={col.width ? { width: col.width } : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (expandContent ? 1 : 0)} className="ui-table-empty">
                {emptyLabel}
              </td>
            </tr>
          ) : data.map((row, index) => {
            const rowKey = keyExtractor(row, index)
            const expandKey = rowToExpandKey ? rowToExpandKey(row, index) : rowKey
            const isExpanded = expandedKeys?.has(expandKey)
            return (
              <Fragment key={rowKey}>
                <tr className={rowClassName?.(row, index) ?? ''}>
                  {expandContent && (
                    <td style={{ textAlign: 'center' }}>
                      {onExpandToggle && (
                        <button
                          className="ui-table-expand-btn"
                          onClick={() => onExpandToggle(expandKey)}
                          title={isExpanded ? '收起' : '展开'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={col.className}>
                      {col.render ? col.render(row, index) : (row as any)[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
                {isExpanded && expandContent && (
                  <tr className="ui-table-expanded-row">
                    <td colSpan={columns.length + 1}>
                      {expandContent(row, index)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
