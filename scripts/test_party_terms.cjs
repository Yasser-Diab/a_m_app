const assert = require("node:assert/strict");
const {
  displayPartyName,
  inferPartyCategory,
  termsSettingKeyForParty,
} = require("../server/domain.cjs");

assert.equal(displayPartyName("عميل بدون تصنيف", "unselected"), "عميل بدون تصنيف");
assert.equal(displayPartyName("عميل فرد", "retail"), "عميل فرد");
assert.equal(displayPartyName("شركة النور", "unselected"), "النور");
assert.equal(displayPartyName("م. أحمد", "retail"), "أحمد");
assert.equal(displayPartyName("النور", "corporate"), "شركة النور");
assert.equal(displayPartyName("أحمد", "engineer"), "م. أحمد");

assert.equal(termsSettingKeyForParty("unselected"), "terms_corporate");
assert.equal(termsSettingKeyForParty(""), "terms_corporate");
assert.equal(termsSettingKeyForParty("corporate"), "terms_corporate");
assert.equal(termsSettingKeyForParty("engineer"), "terms_retail");
assert.equal(termsSettingKeyForParty("retail"), "terms_retail");
assert.equal(inferPartyCategory({ customer_name: "عميل جديد" }), "unselected");

console.log("Party naming and terms-selection regression tests passed.");
