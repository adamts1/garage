/* The demo form and the chat button both open this WhatsApp number.
   International format, no "+". Phone and email render only when set. */
export const CONTACT = {
  whatsapp: '972525600493',
  phone: '',
  email: '',
};

export const whatsappUrl = (text?: string) =>
  `https://wa.me/${CONTACT.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
