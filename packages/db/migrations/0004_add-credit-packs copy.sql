-- Reverse Credit Purchase Ledger
DROP INDEX IF EXISTS `credit_purchases_pack_idx`;
DROP INDEX IF EXISTS `credit_purchases_customer_idx`;
DROP TABLE IF EXISTS `credit_purchases`;

-- Reverse Add-on Credit Packs
DROP INDEX IF EXISTS `credit_packs_slug_idx`;
DROP INDEX IF EXISTS `credit_packs_org_idx`;
DROP TABLE IF EXISTS `credit_packs`;