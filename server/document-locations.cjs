function parts(value) {
  return String(value || "").split("/").map((part) => part.trim()).filter(Boolean);
}

function rowBuildingName(row = {}) {
  return parts(row.building_unit)[0] || "";
}

function rowUnitName(row = {}) {
  const explicit = parts(row.floor_apartment);
  if (explicit.length > 1) return explicit.at(-1);
  if (explicit.length === 1) return explicit[0].toLowerCase() === rowBuildingName(row).toLowerCase() ? "" : explicit[0];
  const combined = parts(row.building_unit);
  return combined.length > 1 ? combined.at(-1) : "";
}

function certificateLocationFields(row = {}) {
  const values = Object.hasOwn(row,"building_unit") || Object.hasOwn(row,"floor_apartment") ? row :
    {building_unit:String(row.location || "").replace(/\s*›\s*/g," / ")};
  return {building_unit:rowBuildingName(values),floor_apartment:rowUnitName(values)};
}

module.exports = {rowBuildingName,rowUnitName,certificateLocationFields};
