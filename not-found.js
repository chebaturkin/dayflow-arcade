I18n.apply();
const home = document.querySelector('a');
const url = new URL(home.href);
url.searchParams.set('lang', I18n.locale);
home.href = url.href;
