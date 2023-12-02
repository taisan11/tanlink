function copyToClipboard() {
  // コピー対象をJavaScript上で変数として定義する
  var copyTarget = document.getElementById("a");
  // コピー対象のテキストを選択する
  copyTarget.select();
  document.execCommand("Copy");
}
