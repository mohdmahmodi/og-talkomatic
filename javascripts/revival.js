/*
 **	==============================================
 **	Talkomatic revival "About this restoration" card
 **	==============================================
 **
 **	Shows a jQuery UI Dialog crediting the community restoration and explaining
 **	that this is the original, untouched version. Auto-opens once per browser
 **	session on the lobby, and can be re-opened from the lobby header link this
 **	script injects. Self-contained: it injects its own styles and needs only a
 **	<script> tag plus jQuery + jQuery UI (already loaded by the lobby pages).
 */
(function () {
  "use strict";

  var SEEN_KEY = "tm_revival_seen";
  var dlg = null; // cached jQuery UI dialog element

  /* Inject the dialog theme (dark plasma-panel look, orange accents). */
  function injectStyles() {
    if (document.getElementById("revival-style")) {
      return;
    }
    var css =
      ".revival-dialog.ui-dialog{border:1px solid #ff8900;box-shadow:0 8px 40px rgba(0,0,0,.6);padding:0;border-radius:6px;overflow:hidden;}" +
      ".revival-dialog .ui-dialog-titlebar{background:#1b1b1b;border:0;border-bottom:1px solid #ff8900;color:#ff8900;border-radius:0;padding:.6em 1em;font-family:Helvetica,Arial,sans-serif;}" +
      ".revival-dialog .ui-dialog-title{font-weight:bold;}" +
      ".revival-dialog .ui-dialog-titlebar-close{border:1px solid #555;background:#2e2929;}" +
      ".revival-dialog .ui-dialog-content{background:#222020;color:#efe8e8;padding:0;font-family:Helvetica,Arial,sans-serif;}" +
      ".revival-dialog .ui-dialog-buttonpane{background:#1b1b1b;border-top:1px solid #3a3535;}" +
      ".revival-dialog .ui-dialog-buttonpane button{background:#000;color:#efe8e8;border:1px solid #ff8900;border-radius:4px;font-weight:bold;}" +
      ".revival-dialog .ui-dialog-buttonpane button:hover{background:#ff8900;color:#000;}" +
      ".revival-body{padding:18px 20px;line-height:1.5;font-size:14px;}" +
      ".revival-body p{margin:.55em 0;}" +
      ".revival-hero{text-align:center;margin-bottom:10px;}" +
      ".revival-avatar{width:84px;height:84px;border-radius:50%;border:2px solid #ff8900;object-fit:cover;vertical-align:middle;}" +
      ".revival-title{color:#ff8900;font-size:18px;font-weight:bold;margin:10px 0 2px;}" +
      ".revival-sub{color:#9a9a9a;font-size:12px;}" +
      ".revival-body a{color:#00b3ff;text-decoration:none;}" +
      ".revival-body a:hover{text-decoration:underline;}" +
      ".revival-note{margin-top:12px;padding:10px 12px;border:1px solid #3a3535;background:#1b1b1b;border-radius:4px;}" +
      ".revival-note b{color:#ff8900;}" +
      ".revival-by{margin-top:14px;padding-top:12px;border-top:1px solid #3a3535;}" +
      ".revival-by .revival-name{color:#ff8900;font-weight:bold;}" +
      ".revival-links{margin:6px 0 0;padding:0;list-style:none;font-size:13px;}" +
      ".revival-links li{margin:3px 0;}" +
      ".revival-links .lbl{display:inline-block;width:74px;color:#9a9a9a;}" +
      ".revival-contact{margin-top:12px;font-size:12px;color:#cdbfae;}" +
      ".revival-reopen{cursor:pointer;}";
    var style = document.createElement("style");
    style.id = "revival-style";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* The card's inner HTML. */
  function bodyHtml() {
    return (
      '<div class="revival-body">' +
      '<div class="revival-hero">' +
      '<img class="revival-avatar" src="/images/mohd-avatar.jpg" alt="Mohd Mahmodi" />' +
      '<div class="revival-title">The original Talkomatic, back online</div>' +
      '<div class="revival-sub">A revival of the 2014 to 2024 web version</div>' +
      "</div>" +
      "<p>This site runs the original Talkomatic browser code. The old server it " +
      "used to talk to is gone, so it now runs on a new server that speaks the " +
      "same protocol the original did.</p>" +
      "<p>The original client was written by <b>David R.&nbsp;Woolley</b> and " +
      "<b>Steven J.&nbsp;Zoppi</b> (2014 to 2021). The server was rewritten for " +
      "this revival.</p>" +
      "<p>Nothing is saved. What you type is sent to the other people in the room " +
      "and then forgotten, the same way the original worked.</p>" +
      '<div class="revival-note">' +
      "<p><b>This is the original version, with nothing added.</b> There is no " +
      "moderation, no auto-mod, and none of the newer features.</p>" +
      "<p>For drawing on a shared <b>whiteboard</b>, <b>playing piano</b> " +
      "together, and moderation, go to " +
      '<a href="https://classic.talkomatic.co" target="_blank" rel="noopener">classic.talkomatic.co</a>.</p>' +
      "</div>" +
      '<div class="revival-by">' +
      '<div>Restored by <span class="revival-name">Mohd Mahmodi</span></div>' +
      '<ul class="revival-links">' +
      '<li><span class="lbl">Website</span><a href="https://mohdmahmodi.com" target="_blank" rel="noopener">mohdmahmodi.com</a></li>' +
      '<li><span class="lbl">X</span><a href="https://x.com/mohdmahmodi" target="_blank" rel="noopener">@mohdmahmodi</a></li>' +
      '<li><span class="lbl">GitHub</span><a href="https://github.com/mohdmahmodi" target="_blank" rel="noopener">@mohdmahmodi</a></li>' +
      '<li><span class="lbl">Email</span><a href="mailto:mohd@mahmodi.com">mohd@mahmodi.com</a></li>' +
      "</ul>" +
      '<p class="revival-contact">To ask for this version to be taken down, ' +
      'email <a href="mailto:mohd@mahmodi.com">mohd@mahmodi.com</a>.</p>' +
      "</div>" +
      "</div>"
    );
  }

  /* Open (creating on first use) the dialog. */
  window.showRevivalDialog = function () {
    injectStyles();
    if (dlg) {
      dlg.dialog("open");
      return;
    }
    var width = Math.min(480, $(window).width() - 30);
    dlg = $("<div></div>")
      .html(bodyHtml())
      .dialog({
        title: "About this restoration",
        dialogClass: "revival-dialog",
        modal: true,
        resizable: false,
        draggable: true,
        width: width,
        show: { effect: "fade", duration: 350 },
        hide: { effect: "fade", duration: 200 },
        buttons: {
          "Start chatting": function () {
            $(this).dialog("close");
          },
        },
      });
  };

  /* Add a re-open link to the lobby header (works for both lobby layouts). */
  function injectReopenLink() {
    var header = document.getElementById("headerlinks");
    if (!header || document.getElementById("revival-reopen")) {
      return;
    }
    var wrap = document.createElement("div");
    wrap.innerHTML =
      '<a id="revival-reopen" class="revival-reopen" href="#" ' +
      'onclick="showRevivalDialog();return false;">About this restoration</a>';
    header.appendChild(wrap);
  }

  $(function () {
    injectStyles();
    injectReopenLink();
    // Greet each visitor once per browser session.
    try {
      if (!window.sessionStorage || !sessionStorage.getItem(SEEN_KEY)) {
        if (window.sessionStorage) {
          sessionStorage.setItem(SEEN_KEY, "1");
        }
        showRevivalDialog();
      }
    } catch (e) {
      showRevivalDialog(); // sessionStorage blocked; just show it
    }
  });
})();
