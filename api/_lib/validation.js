const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateOrderInput(body) {
  if (!body || typeof body !== "object") throw badRequest("Order details are required.");
  const schoolIdentifier = body.school_identifier == null ? null : text(body.school_identifier, 2, 120, 'The school link is invalid.');
  if (schoolIdentifier && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(schoolIdentifier)) throw badRequest('The school link is invalid.');
  const orderingPeriodId = schoolIdentifier ? uuid(body.ordering_period_id, 'The school ordering period is invalid.') : null;
  const schoolToken = schoolIdentifier ? null : text(body.school_token, 8, 300, "The school link is invalid.");
  const idempotencyKey = text(body.request_id, 16, 100, "The request identifier is invalid.");
  const parent = body.parent ?? {};
  const firstName = text(parent.first_name, 2, 100, "Enter the parent's first name.");
  const lastName = text(parent.last_name, 2, 100, "Enter the parent's surname.");
  const email = text(parent.email, 5, 254, "Enter a valid email address.").toLowerCase();
  if (!emailPattern.test(email)) throw badRequest("Enter a valid email address.");
  const mobile = text(parent.mobile, 7, 30, "Enter a valid mobile number.");
  const consent = body.consent ?? {};
  if (consent.accepted !== true) throw badRequest("Accept the terms and privacy policy before continuing.");
  const policyVersion = text(consent.policy_version, 8, 64, "The policy acknowledgement is invalid.");

  if (!Array.isArray(body.learners) || body.learners.length < 1 || body.learners.length > 10) {
    throw badRequest("Add between one and ten children.");
  }

  const learners = body.learners.map((learner) => ({
    first_name: text(learner?.first_name, 2, 100, "Enter each child's first name."),
    last_name: text(learner?.last_name, 2, 100, "Enter each child's surname."),
    offering_id: uuid(learner?.offering_id, "Select an available grade for each child."),
  }));

  return {
    schoolToken,
    schoolIdentifier,
    orderingPeriodId,
    idempotencyKey,
    parent: { first_name: firstName, last_name: lastName, email, mobile },
    consent: { accepted: true, policy_version: policyVersion },
    learners,
  };
}

export function validateStatusInput(body) {
  return {
    reference: text(body?.reference, 6, 40, "The order reference is invalid.").toUpperCase(),
    orderToken: text(body?.order_token, 20, 200, "The order access token is invalid."),
    language: body?.language === "en" ? "en" : "af",
  };
}

export function text(value, min, max, message) {
  if (typeof value !== "string") throw badRequest(message);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw badRequest(message);
  return clean;
}

export function optionalText(value, max) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > max) {
    throw badRequest("One of the supplied fields is too long.");
  }
  return value.trim();
}

export function uuid(value, message = "The identifier is invalid.") {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw badRequest(message);
  return value.toLowerCase();
}

export function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
