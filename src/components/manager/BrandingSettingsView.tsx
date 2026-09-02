import React, { useState, useEffect } from 'react';
import { useRestaurant } from '../../context/RestaurantContext';
import { Restaurant } from '../../types/restaurant';
import { db } from '../../services/db';
import { Palette, Sparkles, Building2, Save, Image, Phone, MapPin, Check } from 'lucide-react';

export const BrandingSettingsView: React.FC = () => {
  const { currentRestaurant, setCurrentRestaurant, refreshTenantData, showToast } = useRestaurant();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logo, setLogo] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#D4AF37');

  useEffect(() => {
    if (currentRestaurant) {
      setName(currentRestaurant.name);
      setNameEn(currentRestaurant.nameEn);
      setDescription(currentRestaurant.description);
      setPhone(currentRestaurant.phone);
      setAddress(currentRestaurant.address);
      setLogo(currentRestaurant.logo);
      setCoverImage(currentRestaurant.coverImage);
      setPrimaryColor(currentRestaurant.primaryColor || '#D4AF37');
    }
  }, [currentRestaurant]);

  if (!currentRestaurant) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: Restaurant = {
      ...currentRestaurant,
      name: name.trim(),
      nameEn: nameEn.trim(),
      description: description.trim(),
      phone: phone.trim(),
      address: address.trim(),
      logo: logo.trim(),
      coverImage: coverImage.trim(),
      primaryColor,
      updatedAt: new Date().toISOString(),
    };

    db.saveRestaurant(updated);
    setCurrentRestaurant(updated);
    refreshTenantData();
    showToast('success', 'تم حفظ إعدادات الهوية بنجاح', 'تم تحديث المظهر الفاخر لقائمتك.');
  };

  return (
    <div className="space-y-6 text-right max-w-4xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-luxury-900 border border-luxury-800 p-5 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-luxury-50 font-serif flex items-center gap-2">
            <Palette className="w-5 h-5 text-gold-400" />
            <span>إعدادات الهوية البصرية والتخصيص الفاخر</span>
          </h2>
          <p className="text-xs text-luxury-400 mt-0.5">
            تخصيص شعار المطعم، صورة الغلاف، لون التمييز، ونصوص الترحيب
          </p>
        </div>

        <button
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl bg-gold-500 hover:bg-gold-400 text-luxury-950 font-bold text-xs flex items-center gap-1.5 shadow-gold-glow"
        >
          <Save className="w-4 h-4" />
          <span>حفظ كافة التغييرات</span>
        </button>
      </div>

      {/* Form Grid */}
      <form onSubmit={handleSave} className="bg-luxury-900 border border-luxury-800 rounded-2xl p-6 shadow-luxury space-y-5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-bold text-luxury-200 mb-1">اسم المطعم (بالعربية)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
            />
          </div>

          <div>
            <label className="block font-bold text-luxury-200 mb-1">الاسم بالإنجليزية</label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
            />
          </div>
        </div>

        <div>
          <label className="block font-bold text-luxury-200 mb-1">الوصف الفاخر للمطعم (يظهر في الهيدر للعميل)</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl focus:border-gold-500/60"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-bold text-luxury-200 mb-1">رقم هاتف المطعم</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
            />
          </div>

          <div>
            <label className="block font-bold text-luxury-200 mb-1">العنوان</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl"
            />
          </div>
        </div>

        {/* Visual Assets Row */}
        <div className="pt-4 border-t border-luxury-800 space-y-4">
          <h4 className="font-bold text-luxury-100 flex items-center gap-2">
            <Image className="w-4 h-4 text-gold-400" />
            <span>الصور والوسائط البصرية</span>
          </h4>

          <div>
            <label className="block font-bold text-luxury-200 mb-1">رابط صورة الغلاف الفاخرة (Hero Cover)</label>
            <input
              type="url"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              className="w-full bg-luxury-950 border border-luxury-800 text-luxury-100 p-2.5 rounded-xl mb-2"
            />
            <img src={coverImage} alt="Cover Preview" className="h-32 w-full object-cover rounded-xl border border-luxury-800" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block font-bold text-luxury-200 mb-1">لون التمييز الفاخر (Theme Accent)</label>
              <div className="flex items-center gap-3 bg-luxury-950 p-2.5 rounded-xl border border-luxury-800">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />
                <span className="font-mono text-gold-400 font-bold">{primaryColor}</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-luxury-950 border border-luxury-800 text-[11px] text-luxury-400">
              يتم تطبيق لون التمييز بدقة على الأزرار والشارات الترويجية وأرقام الطاولات دون الإخلال بالمظهر الداكن الفاخر.
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
