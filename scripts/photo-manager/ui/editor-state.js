export function onHomepage(home, id, section) {
  return section === 'heroIds' && home.heroIds === null ? true : home[section].includes(id);
}
export function placementChanged(home, savedHome, id) {
  return ['selectedIds','heroIds'].some(section=>onHomepage(home,id,section)!==onHomepage(savedHome,id,section));
}
function toggle(items,id,include) {
  return include ? (items.includes(id) ? [...items] : [...items,id]) : items.filter(value=>value!==id);
}
/** Apply only this photo's choices while leaving other unsaved homepage edits pending. */
export function placementForPhoto(home,savedHome,id,savedPhotoIds) {
  const selectedIds=toggle(savedHome.selectedIds,id,onHomepage(home,id,'selectedIds'));
  let heroIds;
  if(savedHome.heroIds===null) heroIds=onHomepage(home,id,'heroIds') ? null : savedPhotoIds.filter(value=>value!==id);
  else heroIds=toggle(savedHome.heroIds,id,onHomepage(home,id,'heroIds'));
  return {selectedIds,heroIds};
}
export function withoutDraft(home,id,remainingIds) {
  const selectedIds=home.selectedIds.filter(value=>value!==id);
  let heroIds=home.heroIds===null ? null : home.heroIds.filter(value=>value!==id);
  if(heroIds && heroIds.length===remainingIds.length && remainingIds.every(value=>heroIds.includes(value))) heroIds=null;
  return {selectedIds,heroIds};
}
