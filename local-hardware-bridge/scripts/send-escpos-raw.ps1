param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$PayloadBase64
)

$source = @'
using System;
using System.Runtime.InteropServices;

public static class NebraxRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di, out int jobId);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] bytes, int count, out int written);
}
'@

if (-not ('NebraxRawPrinter' -as [type])) { Add-Type -TypeDefinition $source }
$bytes = [Convert]::FromBase64String($PayloadBase64)
$handle = [IntPtr]::Zero
if (-not [NebraxRawPrinter]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) { throw "open_printer_failed:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
    $doc = New-Object NebraxRawPrinter+DOCINFO
    $doc.pDocName = 'Nebrax Cash Drawer Pulse'
    $doc.pDataType = 'RAW'
    $job = 0
    if (-not [NebraxRawPrinter]::StartDocPrinter($handle, 1, $doc, [ref]$job)) { throw "start_doc_failed:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    try {
        if (-not [NebraxRawPrinter]::StartPagePrinter($handle)) { throw "start_page_failed:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
        try {
            $written = 0
            if (-not [NebraxRawPrinter]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written) -or $written -ne $bytes.Length) { throw "write_printer_failed:$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
        } finally { [void][NebraxRawPrinter]::EndPagePrinter($handle) }
    } finally { [void][NebraxRawPrinter]::EndDocPrinter($handle) }
} finally {
    if ($handle -ne [IntPtr]::Zero) { [void][NebraxRawPrinter]::ClosePrinter($handle) }
}
