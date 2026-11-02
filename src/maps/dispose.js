/** Free a map's GPU resources. Cached procedural textures (userData.shared) are kept for reuse. */
export function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      if (m.map && !m.map.userData.shared) m.map.dispose();
      m.dispose();
    }
  });
  group.removeFromParent();
}
