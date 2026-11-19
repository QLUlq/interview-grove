param([switch]$Probe)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
  if (!$info) { throw 'No Chinese recognizer' }
  if ($Probe) { '{"available":true}'; exit 0 }
  Add-Type -ReferencedAssemblies ([System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location) -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Speech.Recognition;
public static class LocalDictation {
  public static string Read(byte[] audio) {
    using (var engine = new SpeechRecognitionEngine(new System.Globalization.CultureInfo("zh-CN")))
    using (var stream = new MemoryStream(audio))
    using (var completed = new ManualResetEvent(false)) {
      var text = new StringBuilder();
      Exception failure = null;
      engine.LoadGrammar(new DictationGrammar());
      engine.InitialSilenceTimeout = TimeSpan.FromSeconds(5);
      engine.BabbleTimeout = TimeSpan.FromSeconds(10);
      engine.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs e) {
        if (!String.IsNullOrWhiteSpace(e.Result.Text)) { text.AppendLine(e.Result.Text); }
      };
      engine.RecognizeCompleted += delegate(object sender, RecognizeCompletedEventArgs e) { failure = e.Error; try { completed.Set(); } catch (ObjectDisposedException) {} };
      engine.SetInputToWaveStream(stream);
      engine.RecognizeAsync(RecognizeMode.Multiple);
      if (!completed.WaitOne(TimeSpan.FromSeconds(40))) { engine.RecognizeAsyncCancel(); throw new TimeoutException(); }
      if (failure != null) { throw failure; }
      return text.ToString().Trim();
    }
  }
}
'@
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
  @{text = [LocalDictation]::Read($bytes)} | ConvertTo-Json -Compress
} catch {
  '{"error":"local-recognition-failed"}'
  exit 1
}
