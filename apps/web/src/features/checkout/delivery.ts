import type { Delivery } from '@checkout/contracts';

export type CustomerField = 'name' | 'email' | 'phone';
export type AddressField = 'city' | 'street' | 'house' | 'apartment';
export type CheckoutField = CustomerField | AddressField;

export type DeliveryMethodId = 'pickup' | 'courier';

const trimmedLen = (value: string) => value.trim().length;

/** Courier requires a city, street and house; apartment is optional. */
export function isAddressComplete(values: Readonly<Record<AddressField, string>>): boolean {
  return (
    trimmedLen(values.city) >= 2 && trimmedLen(values.street) >= 2 && trimmedLen(values.house) >= 1
  );
}

/**
 * Build the API delivery object from form state, or null when the selection is
 * not yet complete enough to price (no pickup point / incomplete address).
 * Address content does not affect shipping, so the quote is not rebuilt on every
 * keystroke — only when the method, pickup point or completeness changes.
 */
export function buildDelivery(
  method: DeliveryMethodId,
  pickupPointId: string | null,
  values: Readonly<Record<AddressField, string>>,
): Delivery | null {
  if (method === 'pickup') {
    return pickupPointId ? { method: 'pickup', pickupPointId } : null;
  }
  if (!isAddressComplete(values)) return null;
  const apartment = values.apartment.trim();
  return {
    method: 'courier',
    address: {
      city: values.city.trim(),
      street: values.street.trim(),
      house: values.house.trim(),
      ...(apartment ? { apartment } : {}),
    },
  };
}

/** Human-readable delivery line for summaries. */
export function describeDelivery(delivery: Delivery, pickupTitle?: string): string {
  if (delivery.method === 'pickup') return `Самовывоз — ${pickupTitle ?? delivery.pickupPointId}`;
  const { city, street, house, apartment } = delivery.address;
  return `Курьер — ${city}, ${street}, ${house}${apartment ? `, кв. ${apartment}` : ''}`;
}
