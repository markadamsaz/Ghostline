// Realtime backend for Ghostline. These are the project's public (publishable) values,
// safe to ship in a web page. The game uses Realtime broadcast + presence only:
// no tables, no stored data.
// transport: 'auto' uses the bundled Node relay on localhost and Supabase everywhere else.
// Set it to 'relay' if you self-host with server.js.
window.GHOSTLINE_CONFIG = {
  transport: 'auto',
  supabaseUrl: 'https://brtakwcmjssflnifkkvp.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJydGFrd2NtanNzZmxuaWZra3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjU5MTgsImV4cCI6MjEwNzE0MTkxOH0.oXL35160pDYBZqGVVFb10T9PHhME0A7s2KfTFvX2vYY',
};
