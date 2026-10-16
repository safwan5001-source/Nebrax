<?php
// usage: php -d memory_limit=256M stress.php CASE   -> prints JSON timing/mem; also writes crafted file to stress_files/CASE
error_reporting(E_ALL);
require '/home/user/nibras-app/vendor/autoload.php';
use App\Services\Commerce\StorefrontAnimatedImage as P;
$case=$argv[1]; $MAX=5*1024*1024;
function u16($v){return pack('v',$v);} function u24($v){return substr(pack('V',$v),0,3);} 
function chunk($id,$d){return $id.pack('V',strlen($d)).$d.(strlen($d)&1?"\0":'');}
function gifhead($w,$h){return "GIF89a".u16($w).u16($h)."\xF0\x00\x00\x00\x00\x00\xFF\xFF\xFF";}
$img1=fn($w=1,$h=1)=>"\x2C\0\0\0\0".u16($w).u16($h)."\0\x02\x02\x44\x01\x00";
function webp($frames,$cw=64,$ch=48,$extra=''){ $body='WEBP'.chunk('VP8X',"\x02\0\0\0".u24($cw-1).u24($ch-1)).chunk('ANIM',"\0\0\0\0\0\0").$extra.implode('',$frames); return 'RIFF'.pack('V',strlen($body)).$body; }
$vp8l=chunk('VP8L',hex2bin('2f000000000710fd8ffe072 2a2ff0100'=== '' ? '' : '2f8fc16300 07 10 fd 8f fe 07 22 a2 ff 01 00'));
$vp8l=chunk('VP8L',hex2bin(str_replace(' ','','2f 8f c1 63 00 07 10 fd 8f fe 07 22 a2 ff 01 00')));
$anmf=fn($inner,$w=64,$h=48)=>chunk('ANMF',u24(0).u24(0).u24($w-1).u24($h-1).u24(100)."\0".$inner);
switch($case){
 case 'gif_comment_1byte_subblocks': $b=gifhead(10,10).$img1(10,10)."\x21\xFE".str_repeat("\x01A",(int)(($MAX-100)/2))."\0\x3B"; $mime='image/gif'; break;
 case 'gif_empty_comment_exts': $b=gifhead(10,10).$img1(10,10).str_repeat("\x21\xFE\x00",(int)(($MAX-100)/3))."\x3B"; $mime='image/gif'; break;
 case 'gif_netscape_exts': $b=gifhead(10,10).$img1(10,10).str_repeat("\x21\xFF\x0BNETSCAPE2.0\x03\x01\x00\x00\x00",(int)(($MAX-100)/19))."\x3B"; $mime='image/gif'; break;
 case 'gif_dangling_gce': $b=gifhead(10,10).$img1(10,10).str_repeat("\x21\xF9\x04\x00\x05\x00\x00\x00",(int)(($MAX-100)/8))."\x3B"; $mime='image/gif'; break;
 case 'gif_2000_frames': $b=gifhead(10,10).str_repeat("\x21\xF9\x04\x00\x0A\x00\x00\x00".$img1(10,10),2000)."\x3B"; $mime='image/gif'; break;
 case 'gif_2001_frames': $b=gifhead(10,10).str_repeat("\x21\xF9\x04\x00\x0A\x00\x00\x00".$img1(10,10),2001)."\x3B"; $mime='image/gif'; break;
 case 'gif_5MB_of_frames': $b=gifhead(10,10).str_repeat($img1(10,10),(int)(($MAX-100)/17))."\x3B"; $mime='image/gif'; break;
 case 'gif_2000_frames_5MB': $per=(int)(($MAX-100)/2000)-8-14; $sbs=str_repeat("\xFF".str_repeat('x',255),(int)($per/256)); $fr="\x21\xF9\x04\x00\x0A\x00\x00\x00\x2C\0\0\0\0".u16(10).u16(10)."\0\x02".$sbs."\0"; $b=gifhead(10,10).str_repeat($fr,2000)."\x3B"; $mime='image/gif'; break;
 case 'gif_one_frame_5MB_data': $b=gifhead(10,10)."\x2C\0\0\0\0".u16(10).u16(10)."\0\x02".str_repeat("\xFF".str_repeat('x',255),(int)(($MAX-100)/256))."\0\x3B"; $mime='image/gif'; break;
 case 'gif_300_frames_16k_each': $sbs=str_repeat("\xFF".str_repeat('x',255),64); $fr="\x21\xF9\x04\x00\x0A\x00\x00\x00\x2C\0\0\0\0".u16(10).u16(10)."\0\x02".$sbs."\0"; $b=gifhead(10,10).str_repeat($fr,300)."\x3B"; $mime='image/gif'; break;
 case 'gif_lct_max_x2000': $lct=str_repeat('c',768); $fr="\x21\xF9\x04\x00\x0A\x00\x00\x00\x2C\0\0\0\0".u16(10).u16(10)."\x87".$lct."\x02\x02\x44\x01\x00"; $b=gifhead(10,10).str_repeat($fr,2000)."\x3B"; $mime='image/gif'; break;
 case 'webp_2000_frames': $b=webp(array_fill(0,2000,$anmf($vp8l))); $mime='image/webp'; break;
 case 'webp_2001_frames': $b=webp(array_fill(0,2001,$anmf($vp8l))); $mime='image/webp'; break;
 case 'webp_5MB_of_ANMF': $n=(int)(($MAX-100)/strlen($anmf($vp8l))); $b=webp(array_fill(0,$n,$anmf($vp8l))); $mime='image/webp'; break;
 case 'webp_600k_chunks': $b=webp([]).''; $body='WEBP'.chunk('VP8X',"\x02\0\0\0".u24(63).u24(47)).chunk('ANIM',"\0\0\0\0\0\0").str_repeat("JUNK\0\0\0\0",(int)(($MAX-100)/8)); $b='RIFF'.pack('V',strlen($body)).$body; $mime='image/webp'; break;
 case 'webp_8000_chunks_in_anmf': $b=webp([$anmf($vp8l.str_repeat("JUNK\0\0\0\0",7998))]); $mime='image/webp'; break;
 case 'webp_one_anmf_5MB_vp8l': $b=webp([$anmf(chunk('VP8L',str_repeat('A',$MAX-300))),$anmf($vp8l)]); $mime='image/webp'; break;
 case 'webp_2000_frames_5MB': $per=(int)(($MAX-300)/2000)-40; $b=webp(array_fill(0,2000,$anmf(chunk('VP8L',str_repeat('A',$per))))); $mime='image/webp'; break;
 case 'webp_300_frames_16k': $b=webp(array_fill(0,300,$anmf(chunk('VP8L',str_repeat('A',16000))))); $mime='image/webp'; break;
 case 'webp_many_iccp': $icc=chunk('ICCP',str_repeat('I',65536)); $b=webp([$anmf($vp8l),$anmf($vp8l)],64,48,str_repeat($icc,70)); $mime='image/webp'; break;
 case 'webp_many_alph': $b=webp([$anmf(str_repeat(chunk('ALPH',"\0\0"),7990).$vp8l),$anmf($vp8l)]); $mime='image/webp'; break;
 default: fwrite(STDERR,"unknown\n"); exit(2);
}
@mkdir(__DIR__.'/stress_files'); 
$ext=$mime==='image/gif'?'gif':'webp';
// only save small ones? save all (<=5MB)
file_put_contents(__DIR__."/stress_files/$case.$ext",$b);
$svc=new P(); $res=['case'=>$case,'size'=>strlen($b)];
$t0=hrtime(true); $m0=memory_get_usage(); memory_reset_peak_usage();
try { $meta=$svc->inspect($b,$mime); $res['inspect']='ok:'.$meta['frames'].'f'; } catch(Throwable $e){ $res['inspect']=get_class($e).':'.($e->errorCode??$e->getMessage()); }
$res['inspect_ms']=round((hrtime(true)-$t0)/1e6,1); $res['inspect_peak_MB']=round((memory_get_peak_usage()-$m0)/1048576,1);
if(str_starts_with($res['inspect'],'ok')){
  foreach(['sanitize','posterBytes'] as $m){ memory_reset_peak_usage(); $m1=memory_get_usage(); $t=hrtime(true);
    try{ $r=$svc->$m($b,$mime); $res[$m]='ok:'.($r===null?'null':strlen($r)); }catch(Throwable $e){$res[$m]=get_class($e);} 
    $res[$m.'_ms']=round((hrtime(true)-$t)/1e6,1); $res[$m.'_peak_MB']=round((memory_get_peak_usage()-$m1)/1048576,1); unset($r);}
}
$res['total_peak_MB_incl_input']=round(memory_get_peak_usage()/1048576,1);
echo json_encode($res),"\n";
