# Navbar Integration Task

## Task Overview
Add consistent navigation bar to all view files that are missing it.

## Files Checked
- [x] profile.ejs - Already has navbar
- [x] connect.ejs - Already has navbar
- [x] error.ejs - Added navbar
- [x] home.ejs - Added navbar
- [x] signin.ejs - Already has navbar
- [x] signup.ejs - Already has navbar
- [x] visualize.ejs - Custom navbar replaced with standard partial
- [x] dashboard.ejs - Custom navbar replaced with standard partial

## Changes Made
- [x] Added navbar to views/error.ejs
- [x] Added navbar to views/home.ejs
- [x] Added Bootstrap CSS, Font Awesome, and Bootstrap JS to both files for navbar functionality
- [x] Replaced custom navbar in views/dashboard.ejs with <%- include('./partials/navbar.ejs') %>
- [x] Replaced custom navbar in views/visualize.ejs with <%- include('./partials/navbar.ejs') %>

## Notes
- All view files now use the consistent navigation from partials/navbar.ejs
- Custom styling from dashboard.ejs and visualize.ejs navbars has been standardized
- This ensures consistent navigation experience across all pages
