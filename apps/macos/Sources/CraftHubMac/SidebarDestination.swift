/// Built-in pages and contributed plugin workbenches share the system sidebar's selection model.
enum SidebarDestination: Hashable {
  case builtin(Destination)
  case pluginWorkbench(String)
}
