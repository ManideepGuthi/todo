// reserved for small UX tweaks later (e.g., auto-dismiss alerts)
// Show/Hide password toggles
document.querySelectorAll('.toggle-password')?.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (!input) return;
    const isPwd = input.type === 'password';
    input.type = isPwd ? 'text' : 'password';
    btn.innerHTML = isPwd ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
  });
});

// Confirm password live validation (on signup page)
const pwd = document.getElementById('password');
const cpwd = document.getElementById('confirmPassword');

function validateMatch() {
  if (!pwd || !cpwd) return;
  if (cpwd.value.length === 0) {
    cpwd.classList.remove('is-valid', 'is-invalid');
    return;
  }
  if (pwd.value === cpwd.value) {
    cpwd.classList.add('is-valid');
    cpwd.classList.remove('is-invalid');
  } else {
    cpwd.classList.add('is-invalid');
    cpwd.classList.remove('is-valid');
  }
}

pwd?.addEventListener('input', validateMatch);
cpwd?.addEventListener('input', validateMatch);

// Basic Bootstrap validation styling
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', e => {
    if (!form.checkValidity()) {
      e.preventDefault();
      e.stopPropagation();
    }
    form.classList.add('was-validated');
  }, false);
});
