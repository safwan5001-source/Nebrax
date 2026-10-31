<!doctype html>
<html lang="ar" dir="rtl">
<body style="font-family:Arial,sans-serif;line-height:1.8;color:#1f2937">
    <h2>إعادة تعيين كلمة المرور</h2>
    <p>طُلبت إعادة تعيين كلمة مرور @if($retail)حسابك@else حساب مشتري الجملة@endif في «{{ $storeName }}». اضغط الرابط التالي لاختيار كلمة مرور جديدة. الرابط صالح لمدة {{ intdiv($ttlMinutes, 60) >= 1 ? intdiv($ttlMinutes, 60).' ساعة' : $ttlMinutes.' دقيقة' }} ويُستخدم مرة واحدة:</p>
    <p><a href="{{ $url }}">اختيار كلمة مرور جديدة</a></p>
    <p>بعد التغيير تُنهى جميع جلسات هذا الحساب. إذا لم تطلب ذلك، تجاهل هذه الرسالة؛ كلمة مرورك لم تتغيّر.</p>
    <hr>
    <div dir="ltr" style="text-align:left">
        <h3>Reset your password</h3>
        <p>A password reset was requested for your @if($retail)account @else wholesale buyer account @endif at “{{ $storeName }}”. Use the link below to choose a new password. The link is valid for {{ intdiv($ttlMinutes, 60) >= 1 ? intdiv($ttlMinutes, 60).' hour(s)' : $ttlMinutes.' minutes' }} and can be used once:</p>
        <p><a href="{{ $url }}">Choose a new password</a></p>
        <p>After the change, every session of this account is signed out. If you did not request this, ignore this message; your password has not changed.</p>
    </div>
</body>
</html>
