UPDATE plan_features
SET reset_on_enable = 1
WHERE COALESCE(usage_model, 'included') IN ('included', 'prepaid')
  AND reset_on_enable IS NOT 1;
