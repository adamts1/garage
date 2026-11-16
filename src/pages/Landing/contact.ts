/* The demo form and the chat button both open this WhatsApp number.
   International format, no "+". Phone and email render only when set. */
export const CONTACT = {
  whatsapp: '972525600493',
  phone: '',
  email: '',
};

export const whatsappUrl = (text?: string) =>
  `https://wa.me/${CONTACT.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/* Production store listings (ascAppId in mobile/eas.json, android.package in
   mobile/app.config.js). */
export const STORES = {
  appStore: 'https://apps.apple.com/app/id6790709441',
  googlePlay: 'https://play.google.com/store/apps/details?id=com.tsityat.garageapp',
};

export const AGENCY_URL = 'https://tsityat.com';
