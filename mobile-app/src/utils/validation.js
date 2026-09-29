export function isValidPhone(phone) {
  return /^\+?\d{7,15}$/.test(String(phone || '').replace(/[\s-]/g, ''));
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

export function passwordIssues(password) {
  const issues = [];
  if (!password || password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Z]/.test(password || '')) issues.push('an uppercase letter');
  if (!/[0-9]/.test(password || '')) issues.push('a number');
  return issues;
}
