// Input Validation Utilities

// Validate Phone Number
const validatePhoneNumber = (phoneNumber) => {
  const phoneRegex = /^[\d\s\-\+\(\)]{10,}$/;
  return phoneRegex.test(phoneNumber);
};

// Validate Username
const validateUsername = (username) => {
  // Username: 3-20 characters, alphanumeric and underscore
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  return usernameRegex.test(username);
};

// Validate Email (optional)
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate Password Strength
const validatePasswordStrength = (password) => {
  // Requirements:
  // - Minimum 8 characters
  // - At least one uppercase letter
  // - At least one lowercase letter
  // - At least one number
  // - At least one special character
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

// Get Password Strength Requirements
const getPasswordRequirements = () => {
  return {
    minLength: 8,
    requirements: [
      '✅ Minimum 8 characters',
      '✅ At least one uppercase letter (A-Z)',
      '✅ At least one lowercase letter (a-z)',
      '✅ At least one number (0-9)',
      '✅ At least one special character (@$!%*?&)'
    ]
  };
};

// Check password strength and return feedback
const checkPasswordStrength = (password) => {
  const feedback = {
    isStrong: validatePasswordStrength(password),
    score: 0,
    messages: []
  };

  if (password.length >= 8) {
    feedback.score++;
  } else {
    feedback.messages.push('❌ Password must be at least 8 characters');
  }

  if (/[a-z]/.test(password)) {
    feedback.score++;
  } else {
    feedback.messages.push('❌ Add at least one lowercase letter');
  }

  if (/[A-Z]/.test(password)) {
    feedback.score++;
  } else {
    feedback.messages.push('❌ Add at least one uppercase letter');
  }

  if (/\d/.test(password)) {
    feedback.score++;
  } else {
    feedback.messages.push('❌ Add at least one number');
  }

  if (/@$!%*?&/.test(password)) {
    feedback.score++;
  } else {
    feedback.messages.push('❌ Add at least one special character (@$!%*?&)');
  }

  return feedback;
};

const normalizePhone = (phone) => {
  if (!phone) return '';
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length >= 9) {
    return '251' + clean.slice(-9);
  }
  return clean;
};

module.exports = {
  validatePhoneNumber,
  normalizePhone,
  validateUsername,
  validateEmail,
  validatePasswordStrength,
  getPasswordRequirements,
  checkPasswordStrength
};

