#!/usr/bin/env bash
# Create the Fennex products and prices in Stripe, with the lookup keys the
# webhook needs, then print the env vars to paste into .env
#
#   stripe login                 # once, picks the account
#   ./scripts/stripe-setup.sh    # test mode by default
#
# Re-running creates DUPLICATE products — Stripe has no upsert here. If you need
# to start over, archive the old products in the Dashboard first.
#
# Prices are immutable in Stripe. To change one later, create a new price and
# move the lookup key to it:
#   stripe prices create --product prod_xxx --unit-amount 3900 --currency usd \
#     -d "recurring[interval]=month" --lookup-key starter_monthly --transfer-lookup-key
set -euo pipefail

if ! command -v stripe >/dev/null; then
  echo "stripe CLI not found: https://stripe.com/docs/stripe-cli" >&2
  exit 1
fi

# plan | display name | monthly cents | annual cents (12 months for the price of 10)
PLANS=(
  "starter|Fennex Starter|2900|29000"
  "pro|Fennex Pro|9900|99000"
  "agency|Fennex Agency|29900|299000"
  "scale|Fennex Scale|79900|799000"
)

echo "# ---- paste into .env ----"
for row in "${PLANS[@]}"; do
  IFS="|" read -r plan name monthly annual <<<"$row"

  product_id=$(stripe products create --name "$name" 2>/dev/null | grep -o '"id": *"prod_[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$product_id" ]; then
    echo "failed to create product for $plan" >&2
    exit 1
  fi

  # The lookup key is what webhooks.py reads to map a subscription back to a
  # plan tier. Without it the subscription is created and never mapped.
  monthly_id=$(stripe prices create --product "$product_id" \
    --unit-amount "$monthly" --currency usd \
    -d "recurring[interval]=month" \
    --lookup-key "${plan}_monthly" 2>/dev/null | grep -o '"id": *"price_[^"]*"' | head -1 | cut -d'"' -f4)

  annual_id=$(stripe prices create --product "$product_id" \
    --unit-amount "$annual" --currency usd \
    -d "recurring[interval]=year" \
    --lookup-key "${plan}_annual" 2>/dev/null | grep -o '"id": *"price_[^"]*"' | head -1 | cut -d'"' -f4)

  upper=$(echo "$plan" | tr '[:lower:]' '[:upper:]')
  echo "STRIPE_PRICE_${upper}_MONTHLY=${monthly_id}"
  echo "STRIPE_PRICE_${upper}_ANNUAL=${annual_id}"
done
echo "# -------------------------"
echo
echo "Next: add the webhook endpoint and put its whsec_ into STRIPE_WEBHOOK_SECRET." >&2
