import { useEffect, useState, type ReactNode } from 'react'
import type { EventCategory, ExportDataset, HistoryEvent } from '@shared/types'
import { useI18n, useFormat, categoryText } from '../i18n'
import { useToast } from '../hooks/useToast'
import { Badge, Card, CardHead, EmptyState, Segmented } from '../components/ui'
import { IconDatabase, IconDownload, IconFile, IconHistory, IconSearch } from '../components/Icons'

type RangeKey = '7' | '30' | '90' | 'all'
const CATEGORIES: EventCategory[] = ['device', 'network', 'alert', 'scan', 'system', 'traffic']

export default function History(): ReactNode {
  const { t, language } = useI18n()
  const format = useFormat()
  const toast = useToast()
  const [range, setRange] = useState<RangeKey>('7')
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [search, setSearch] = useState('')
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(100)

  const from = range === 'all' ? undefined : Date.now() - Number(range) * 24 * 60 * 60_000

  const load = async (): Promise<void> => {
    const page = await window.netwatch.getHistory({
      from,
      categories: categories.length > 0 ? categories : undefined,
      search: search.trim() || undefined,
      limit,
      offset: 0
    })
    setEvents(page.events)
    setTotal(page.total)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, categories, search, limit])

  const exportData = async (dataset: ExportDataset, formatType: 'csv' | 'json'): Promise<void> => {
    try {
      const result = await window.netwatch.exportData({ dataset, format: formatType, from, to: Date.now() })
      if (result.canceled) return
      toast.success(t('toast.exported'), t('toast.exportedBody', { rows: result.rows }))
    } catch (error) {
      toast.error(t('toast.exportFailed'), error instanceof Error ? error.message : undefined)
    }
  }

  const toggleCategory = (category: EventCategory): void => {
    setCategories((current) =>
      current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category]
    )
  }

  return (
    <div className="page">
      <Card>
        <div className="toolbar">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: t('history.last7') },
              { value: '30', label: t('history.last30') },
              { value: '90', label: t('history.last90') },
              { value: 'all', label: t('history.all') }
            ]}
          />
          <div className="search grow">
            <IconSearch size={15} />
            <input
              className="input"
              placeholder={t('history.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className="btn" onClick={() => void exportData('events', 'csv')}>
            <IconDownload size={15} />
            {t('history.exportCsv')}
          </button>
          <button className="btn" onClick={() => void exportData('events', 'json')}>
            <IconFile size={15} />
            {t('history.exportJson')}
          </button>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
          {CATEGORIES.map((category) => (
            <button
              key={category}
              className={`chip${categories.includes(category) ? ' active' : ''}`}
              onClick={() => toggleCategory(category)}
            >
              {categoryText(language, category)}
            </button>
          ))}
          <span className="tiny muted" style={{ marginLeft: 'auto' }}>
            {total} {t('history.total')}
          </span>
        </div>
      </Card>

      <Card className="pad-0">
        <div className="table-wrap" style={{ border: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 170 }}>{t('common.date')}</th>
                <th style={{ width: 120 }}>{t('history.category')}</th>
                <th>{t('common.description')}</th>
                <th style={{ width: 180 }}>{t('common.device')}</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState icon={<IconHistory size={20} />} title={t('history.noEvents')} description={t('history.noEventsHint')} />
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td className="tiny muted tabular">{format.dateTime(event.createdAt)}</td>
                    <td>
                      <Badge
                        tone={
                          event.category === 'alert'
                            ? 'warn'
                            : event.category === 'device'
                              ? 'accent'
                              : event.category === 'network'
                                ? 'info'
                                : 'neutral'
                        }
                      >
                        {categoryText(language, event.category)}
                      </Badge>
                    </td>
                    <td>{event.message}</td>
                    <td className="tiny muted truncate">{event.deviceName ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {events.length < total ? (
          <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
            <button className="btn" onClick={() => setLimit((current) => current + 100)}>
              {t('history.loadMore')}
            </button>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHead title={t('history.exportTitle')} subtitle={t('set.dataManagement')} />
        <div className="row wrap" style={{ gap: 9 }}>
          <button className="btn" onClick={() => void exportData('devices', 'csv')}>
            <IconDatabase size={15} />
            {t('history.devicesExport')}
          </button>
          <button className="btn" onClick={() => void exportData('alerts', 'csv')}>
            <IconDatabase size={15} />
            {t('history.alertsExport')}
          </button>
          <button className="btn" onClick={() => void exportData('traffic', 'csv')}>
            <IconDatabase size={15} />
            {t('history.trafficExport')}
          </button>
          <button className="btn" onClick={() => void exportData('connections', 'csv')}>
            <IconDatabase size={15} />
            {t('history.connectionsExport')}
          </button>
        </div>
      </Card>
    </div>
  )
}
