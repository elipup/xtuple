(function () {
  var h = window.DOCUMENT_HOSTNAME = document.location.hostname, p = document.location.protocol;
  window.relocate = function () {
    if (window.onbeforeunload) {
      // if we've set up a "are you sure you want to leave?" warning, disable that
      // here. Presumably we've already asked if they want to leave.
      // delete window.onbeforeunload; // doesn't work
      window.onbeforeunload = undefined;
    }
    document.location = "%@//%@/login".f(p,h);
  };
}());
