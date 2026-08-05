# Manual Deletion Handoff — 2026-08-05 Production Cleanup

Everything on this list is a permanent-delete action. Per this assistant's operating
rules, permanent deletion is never performed automatically, even with authorization —
these need to be done by you, directly, in each platform's own UI. Everything here has
already been confirmed safe to remove: either archived duplicates (Shopify, reversible
until you hard-delete) or orphaned products in a shop that is being fully retired
(Printify).

Do not delete anything in this list until the corresponding Phase 4 replacement design
has been verified live and orderable in the correct shop (28435012 / "My Shopify
Store") — see docs/2026-08-05-printify-shopify-incident-report.md §6 for the plan this
follows.

## 1. Printify — delete these 27 orphan products (shop 18594781, "Riddimroom.com")

This entire shop is being retired (bound to a dead Shopify store, no products worth
keeping). All 27 products below can be deleted once the corresponding design is
confirmed live in shop 28435012.

Go to printify.com → switch to shop "Riddimroom.com" → Catalog / My Products → select
each → Delete. (Printify's UI supports multi-select delete.)

| Printify Product ID | Title |
|---|---|
| 6a7346ef6a1168d41d0fa36c | Wah Gwaan Phrase Tee |
| 6a7346e6abfc8aa375047b51 | Watch Nah T-Shirt |
| 6a7346dc6a1168d41d0fa346 | Soon Come Caribbean Phrase T-Shirt |
| 6a7346d298e12385f90d5325 | Riddim - The Heartbeat of Caribbean Music T-Shirt |
| 6a7346c8a178d5d914047f28 | Pickney T-Shirt |
| 6a7346bfa08338f8d0073999 | Liming Definition T-Shirt |
| 6a7346b5a08338f8d0073985 | Irie Caribbean Dictionary T-Shirt |
| 6a7346ad98e12385f90d52fc | Chipping T-Shirt - Caribbean Dictionary Series No. 015 |
| 6a7346a0a178d5d914047eec | Big Up Yourself T-Shirt |
| 6a7345866c4becd8c40e9408 | Wah Gwaan T-Shirt - Caribbean Dictionary Collection |
| 6a73457b6c4becd8c40e93f4 | Watch Nah - Caribbean Expression Tee |
| 6a734570a08338f8d00737eb | Soon Come Caribbean Phrase T-Shirt |
| 6a734564a08338f8d00737e0 | Riddim - The Heartbeat of Caribbean Music T-Shirt |
| 6a73455af366b0c75509c3b1 | Pickney Definition T-Shirt |
| 6a734551f366b0c75509c3a9 | Liming: Caribbean Lifestyle Tee |
| 6a7345476162b552490e1b98 | Irie Definition T-Shirt |
| 6a73453f6c4becd8c40e93c2 | Chipping T-Shirt – Caribbean Dictionary Series No. 015 |
| 6a7345366162b552490e1b84 | Big Up Yourself Tee - Caribbean Dictionary Collection |
| 6a7331419055a1bc5605a4cb | Wah Gwaan T-Shirt |
| 6a7331376fd816cf93041f44 | Watch Nah T-Shirt |
| 6a73312d00c18d30960d8ec0 | Soon Come Phrase T-Shirt |
| 6a733120ff4e090b5a02af59 | Riddim Typography Tee |
| 6a733117ff4e090b5a02af55 | Pickney Definition Tee - Caribbean Dictionary Series No. 007 |
| 6a73310d6fd816cf93041f2d | Liming: The Art of Gathering |
| 6a73310400c18d30960d8e92 | Irie Caribbean Dictionary T-Shirt |
| 6a7330fb6fd816cf93041f22 | Chipping: Slow Dance T-Shirt |
| 6a7330f0931c4b338903233f | Big Up Yourself T-Shirt |

After all 27 are deleted and confirmed empty, the "Riddimroom.com" shop entity itself
(id 18594781) and the unused "My Store" shop (id 18595310, 0 products) can be removed
from your Printify account entirely — Settings → Stores → disconnect/remove. This is
an account-level action outside this codebase's scope.

## 2. Printify — flagged item requiring your own judgment call (correct shop)

This one sits in the *correct* shop (28435012) but is not linked to any Shopify
product — likely an accidental duplicate from an earlier editor session (a browser tab
on this exact product got stuck mid-session). Confirm it's not needed before deleting.

| Printify Product ID | Title | Shop |
|---|---|---|
| 6a72b9221299797f13041225 | Copy of Caribbean Treasure Chest RiddimRoom T-Shirt | My Shopify Store (28435012) |

## 3. Shopify — archived automatically, listed here for your records

These will be set to ARCHIVED status (not deleted) via the Shopify Admin API once each
design's replacement is verified live. Archived products stay in your admin, out of
the storefront and search, and can be restored to Active at any time. If you want them
permanently deleted instead of archived, that's a separate action you'd take yourself
in Shopify Admin → Products → (select archived items) → Delete.

| Shopify Product ID | Title | Status before archive | Design |
|---|---|---|---|
| 8685100335254 | Big Up Yourself T-Shirt | ACTIVE | Big Up |
| 8685190742166 | Big Up Yourself Tee - Caribbean Dictionary Collection | DRAFT | Big Up |
| 8685201555606 | Big Up Yourself T-Shirt | DRAFT | Big Up |
| 8685100400790 | Chipping: Slow Dance T-Shirt | ACTIVE | Chipping |
| 8685190807702 | Chipping T-Shirt – Caribbean Dictionary Series No. 015 | DRAFT | Chipping |
| 8685201588374 | Chipping T-Shirt - Caribbean Dictionary Series No. 015 | DRAFT | Chipping |
| 8685100433558 | Irie Caribbean Dictionary T-Shirt | ACTIVE | Irie |
| 8685190840470 | Irie Definition T-Shirt | DRAFT | Irie |
| 8685201653910 | Irie Caribbean Dictionary T-Shirt | DRAFT | Irie |
| 8685100466326 | Liming: The Art of Gathering | ACTIVE | Liming |
| 8685191856278 | Liming: Caribbean Lifestyle Tee | DRAFT | Liming |
| 8685201686678 | Liming Definition T-Shirt | DRAFT | Liming |
| 8685100499094 | Pickney Definition Tee - Caribbean Dictionary Series No. 007 | ACTIVE | Pickney |
| 8685191889046 | Pickney Definition T-Shirt | DRAFT | Pickney |
| 8685201752214 | Pickney T-Shirt | DRAFT | Pickney |
| 8685100925078 | Riddim Typography Tee | ACTIVE | Riddim |
| 8685191921814 | Riddim - The Heartbeat of Caribbean Music T-Shirt | DRAFT | Riddim |
| 8685201817750 | Riddim - The Heartbeat of Caribbean Music T-Shirt | DRAFT | Riddim |
| 8685101318294 | Soon Come Phrase T-Shirt | ACTIVE | Soon Come |
| 8685191954582 | Soon Come Caribbean Phrase T-Shirt | DRAFT | Soon Come |
| 8685201850518 | Soon Come Caribbean Phrase T-Shirt | DRAFT | Soon Come |
| 8685101613206 | Watch Nah T-Shirt | ACTIVE | Watch Nah |
| 8685191987350 | Watch Nah - Caribbean Expression Tee | DRAFT | Watch Nah |
| 8685201916054 | Watch Nah T-Shirt | DRAFT | Watch Nah |
| 8685192020118 | Wah Gwaan T-Shirt - Caribbean Dictionary Collection | ACTIVE | Wah Gwaan |
| 8685201948822 | Wah Gwaan Phrase Tee | DRAFT | Wah Gwaan |

Wah Gwaan's replacement depends on task #125 (diagnosing Printify error 8251) being
resolved first — its 2 rows above should be archived last, after that's done.
