// Result of sending a website enquiry or quote request.
export type EnquiryState = { status: "idle" } | { status: "sent"; reference: string } | { status: "error"; error: string };
