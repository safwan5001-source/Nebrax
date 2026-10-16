<?php
require '/home/user/nibras-app/vendor/autoload.php';
use App\Services\Commerce\StorefrontAnimatedImage as P;
function u24($v){return substr(pack('V',$v),0,3);} function chunk($id,$d){return $id.pack('V',strlen($d)).$d.(strlen($d)&1?"\0":'');}
$vp8l=chunk('VP8L',hex2bin('2f8fc16300 0710fd8ffe0722a2ff0100'===''?'':str_replace(' ','','2f 8f c1 63 00 07 10 fd 8f fe 07 22 a2 ff 01 00')));
$junk="JUNK\0\0\0\0";
function webp($frames){ $body='WEBP'.chunk('VP8X',"\x02\0\0\0".u24(63).u24(47)).chunk('ANIM',"\0\0\0\0\0\0").implode('',$frames); return 'RIFF'.pack('V',strlen($body)).$body; }
$anmf=fn($inner)=>chunk('ANMF',u24(0).u24(0).u24(63).u24(47).u24(100)."\0".$inner);
$cases=[
 'frames=600,junk/frame=1000' => webp(array_fill(0,600,$anmf($vp8l.str_repeat($junk,1000)))),
 'frames=1999,junk/frame=320' => webp(array_fill(0,1999,$anmf($vp8l.str_repeat($junk,320)))),
 'frames=100,junk/frame=7990' => webp(array_fill(0,100,$anmf($vp8l.str_repeat($junk,7990)))),
 'frames=1,junk=7990 + 5MB vp8l' => webp([$anmf($vp8l.str_repeat($junk,7990)), $anmf(chunk('VP8L',str_repeat('A',5000000)))]),
 'frames=2, ICCP x 80 (64KB each)' => '',
];
unset($cases['frames=2, ICCP x 80 (64KB each)']);
$svc=new P();
foreach($cases as $k=>$b){ $b=substr($b,0,5*1024*1024); 
  $res=[]; foreach(['inspect','sanitize','posterBytes'] as $m){ memory_reset_peak_usage(); $m0=memory_get_usage(); $t=hrtime(true);
    try{ $svc->$m($b,'image/webp'); $r='ok'; }catch(Throwable $e){ $r=$e->errorCode??get_class($e);} $res[]=sprintf('%s=%s %.0fms %.1fMB',$m,$r,(hrtime(true)-$t)/1e6,(memory_get_peak_usage()-$m0)/1048576); }
  printf("%-34s size=%.2fMB  %s\n",$k,strlen($b)/1048576,implode(' | ',$res)); }
