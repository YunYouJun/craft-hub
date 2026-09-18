export const inspectorFrameId = 'craft-hub'
export const inspectorGroupId = 'craft-hub:inspector'
export const inspectorTabs = [
  { id: 'projects', title: '项目', icon: 'lucide:folder-search' },
  { id: 'diagnostics', title: '诊断', icon: 'lucide:heart-pulse' },
  { id: 'runs', title: '运行记录', icon: 'lucide:history' },
] as const
export type InspectorTab = typeof inspectorTabs[number]['id']

export function isInspectorTab(value: unknown): value is InspectorTab {
  return inspectorTabs.some(tab => tab.id === value)
}
