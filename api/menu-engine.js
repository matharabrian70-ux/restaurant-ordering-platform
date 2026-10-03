export function registerMenuEngine(app, pool, requireManager = (_req,_res,next)=>next(), broadcastRealtime = ()=>{}) {
  function clean(value) { return String(value ?? '').trim(); }
  function normalizeProductOptions(raw) {
    if (raw == null || raw === '') return [];
    if (!Array.isArray(raw)) throw new Error('Menu variables must be an array');
    if (raw.length > 20) throw new Error('A menu item can have at most 20 variable groups');
    const seenGroups = new Set();
    return raw.map((group, gi) => {
      const name = clean(group?.name);
      if (!name || name.length > 80) throw new Error('Each variable group needs a name of 1–80 characters');
      const groupKey = name.toLowerCase();
      if (seenGroups.has(groupKey)) throw new Error('Variable group names must be unique');
      seenGroups.add(groupKey);
      if (!Array.isArray(group?.choices) || group.choices.length < 1 || group.choices.length > 30) {
        throw new Error('Each variable group needs 1–30 choices');
      }
      const seenChoices = new Set();
      const choices = group.choices.map((choice) => {
        const key = clean(Array.isArray(choice) ? choice[0] : choice?.key);
        const label = clean(Array.isArray(choice) ? choice[1] : choice?.label);
        const surcharge = Number(Array.isArray(choice) ? choice[2] : choice?.price || 0);
        if (!key || key.length > 80 || !label || label.length > 120 || !Number.isFinite(surcharge) || surcharge < 0 || surcharge > 100000) {
          throw new Error('Each variable choice needs a valid key, label and non-negative price adjustment');
        }
        if (seenChoices.has(key.toLowerCase())) throw new Error('Choice keys must be unique within a variable group');
        seenChoices.add(key.toLowerCase());
        return [key, label, surcharge];
      });
      return { name, choices };
    });
  }
  function normalizePromotion(body) {
    const type = ['PERCENT','FIXED','SPECIAL_PRICE','BUY_X_GET_Y','FREE_ITEM'].includes(String(body.type || '').toUpperCase()) ? String(body.type).toUpperCase() : null;
    if (!type) throw new Error('Invalid promotion type');
    const value = Number(body.value || 0);
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid promotion value');
    return {
      name: clean(body.name), type, value, minOrder: Number(body.minOrder || 0),
      startsAt: body.startsAt || null, endsAt: body.endsAt || null,
      daysOfWeek: Array.isArray(body.daysOfWeek) ? body.daysOfWeek.map(Number).filter(n => n >= 0 && n <= 6) : [],
      startTime: body.startTime || null, endTime: body.endTime || null,
      active: body.active !== false, bannerText: clean(body.bannerText),
      productIds: Array.isArray(body.productIds) ? body.productIds : [], category: clean(body.category) || null
    };
  }
  app.get('/api/menu', requireManager, async (req,res) => {
    try {
      const businessId=clean(req.query.businessId); if(!businessId) return res.status(400).json({error:'businessId is required'});
      const [cats,products,promos]=await Promise.all([
        pool.query('select id,name,description,sort_order,active from menu_categories where business_id=$1 order by sort_order,name',[businessId]),
        pool.query('select p.*,coalesce(c.name,p.category) as category_name from products p left join menu_categories c on c.id=p.category_id where p.business_id=$1 order by coalesce(c.sort_order,999),p.name',[businessId]),
        pool.query('select * from promotions where business_id=$1 order by active desc, starts_at nulls first, created_at desc',[businessId])
      ]);
      res.json({categories:cats.rows,products:products.rows,promotions:promos.rows});
    } catch(e){res.status(500).json({error:e.message||'Unable to load menu'});}
  });
  app.post('/api/menu/categories', requireManager, async(req,res)=>{
    try{const businessId=clean(req.body.businessId),name=clean(req.body.name);if(!businessId||!name)return res.status(400).json({error:'Business and category name are required'});const r=await pool.query('insert into menu_categories(id,business_id,name,description,sort_order,active) values(gen_random_uuid(),$1,$2,$3,coalesce((select max(sort_order)+1 from menu_categories where business_id=$1),0),true) returning *',[businessId,name,clean(req.body.description)||null]);broadcastRealtime({businessId,event:'menu.updated',data:{type:'CATEGORY_CREATED',category:r.rows[0]}});res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||'Unable to create category'});}
  });
  app.patch('/api/menu/categories/:id', requireManager, async(req,res)=>{try{
    const sets=[],vals=[];
    for(const [key,col] of [['name','name'],['description','description'],['active','active'],['sortOrder','sort_order']]){
      if(req.body[key]!==undefined){
        sets.push(`${col}=${vals.length+3}`);
        vals.push(key==='sortOrder'?Number(req.body[key]):key==='active'?Boolean(req.body[key]):clean(req.body[key]));
      }
    }
    if(!sets.length)return res.status(400).json({error:'No changes supplied'});
    const businessId=clean(req.body.businessId);
    const params=[req.params.id,businessId,...vals];
    const r=await pool.query(`update menu_categories set ${sets.join(',')},updated_at=now() where id=$1 and business_id=$2 returning *`,params);
    if(!r.rowCount)return res.status(404).json({error:'Category not found'});
    broadcastRealtime({businessId,event:'menu.updated',data:{type:'CATEGORY_UPDATED',category:r.rows[0]}});
    res.json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.message||'Unable to update category'});}});
  app.post('/api/menu/products', requireManager, async(req,res)=>{
    try{const b=clean(req.body.businessId),name=clean(req.body.name),price=Number(req.body.price);if(!b||!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Business, name and valid price are required'});const categoryId=clean(req.body.categoryId)||null;let category=clean(req.body.category)||null;if(categoryId){const c=await pool.query('select name from menu_categories where id=$1 and business_id=$2',[categoryId,b]);if(!c.rowCount)return res.status(400).json({error:'Category not found'});category=c.rows[0].name;}const r=await pool.query('insert into products(id,business_id,name,category,category_id,description,price,image_url,active,featured,options,hero_image_url) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *',[b,name,category,categoryId,clean(req.body.description)||null,price,clean(req.body.imageUrl)||null,req.body.active!==false,Boolean(req.body.featured),JSON.stringify(normalizeProductOptions(req.body.options)),clean(req.body.heroImageUrl)||null]);broadcastRealtime({businessId:b,event:'menu.updated',data:{type:'PRODUCT_CREATED',product:r.rows[0]}});res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||'Unable to create menu item'});}
  });
  app.patch('/api/menu/products/:id', requireManager, async(req,res)=>{
    try{const b=clean(req.body.businessId);const current=await pool.query('select * from products where id=$1 and business_id=$2',[req.params.id,b]);if(!current.rowCount)return res.status(404).json({error:'Menu item not found'});const map={name:'name',description:'description',price:'price',imageUrl:'image_url',heroImageUrl:'hero_image_url',active:'active',featured:'featured',options:'options'};const sets=[],vals=[];for(const [key,col] of Object.entries(map))if(req.body[key]!==undefined){let v=req.body[key];if(key==='price')v=Number(v);if(key==='options')v=JSON.stringify(normalizeProductOptions(v));if(key==='active'||key==='featured')v=Boolean(v);if(key==='imageUrl'||key==='name'||key==='description')v=clean(v);sets.push(`${col}=$${vals.length+2}`);vals.push(v)}if(req.body.categoryId!==undefined){const cid=clean(req.body.categoryId)||null;let category=null;if(cid){const c=await pool.query('select name from menu_categories where id=$1 and business_id=$2',[cid,b]);if(!c.rowCount)return res.status(400).json({error:'Category not found'});category=c.rows[0].name;}sets.push(`category_id=$${vals.length+2}`);vals.push(cid);sets.push(`category=$${vals.length+2}`);vals.push(category);}if(!sets.length)return res.status(400).json({error:'No changes supplied'});vals.unshift(req.params.id,b);const r=await pool.query(`update products set ${sets.join(',')},updated_at=now() where id=$1 and business_id=$2 returning *`,vals);broadcastRealtime({businessId:b,event:'menu.updated',data:{type:'PRODUCT_UPDATED',product:r.rows[0]}});res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||'Unable to update menu item'});}
  });
  function normalizeCoupon(body) {
    const code=clean(body.code).toUpperCase();
    const name=clean(body.name);
    const discountType=['PERCENT','FIXED'].includes(String(body.discountType||'').toUpperCase()) ? String(body.discountType).toUpperCase() : null;
    const discountValue=Number(body.discountValue);
    const minOrderAmount=Number(body.minOrderAmount||0);
    const maxRedemptions=body.maxRedemptions===''||body.maxRedemptions==null?null:Number(body.maxRedemptions);
    if(!code || !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code)) throw new Error('Promo code must be 3–40 characters using letters, numbers, _ or -');
    if(!name || name.length>120) throw new Error('Promo name is required');
    if(!discountType) throw new Error('Invalid discount type');
    if(!Number.isFinite(discountValue) || discountValue<=0 || (discountType==='PERCENT' && discountValue>100)) throw new Error('Invalid discount value');
    if(!Number.isFinite(minOrderAmount) || minOrderAmount<0) throw new Error('Invalid minimum order amount');
    if(maxRedemptions!==null && (!Number.isInteger(maxRedemptions) || maxRedemptions<1)) throw new Error('Invalid redemption limit');
    return {code,name,discountType,discountValue,minOrderAmount,maxRedemptions,active:body.active!==false,startsAt:body.startsAt||null,expiresAt:body.expiresAt||null};
  }
  app.get('/api/menu/coupons', requireManager, async(req,res)=>{
    try{
      const businessId=clean(req.query.businessId);
      if(!businessId)return res.status(400).json({error:'businessId is required'});
      const r=await pool.query('select id,code,discount_type,discount_value,min_order_amount,max_redemptions,redeemed_count,active,starts_at,expires_at from customer_coupons where business_id=$1 order by active desc,created_at desc',[businessId]);
      res.json(r.rows);
    }catch(e){res.status(500).json({error:e.message||'Unable to load promo codes'});}
  });
  app.post('/api/menu/coupons', requireManager, async(req,res)=>{
    try{
      const b=clean(req.body.businessId),p=normalizeCoupon(req.body);
      if(!b)return res.status(400).json({error:'Business is required'});
      const r=await pool.query(
        'insert into customer_coupons(id,business_id,code,discount_type,discount_value,min_order_amount,max_redemptions,active,starts_at,expires_at) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,coalesce($8,now()),$9) returning id,code,discount_type,discount_value,min_order_amount,max_redemptions,redeemed_count,active,starts_at,expires_at',
        [b,p.code,p.discountType,p.discountValue,p.minOrderAmount,p.maxRedemptions,p.active,p.startsAt,p.expiresAt]
      );
      broadcastRealtime({businessId:b,event:'promotion.updated',data:{type:'COUPON_CREATED',coupon:r.rows[0]}});
      res.status(201).json(r.rows[0]);
    }catch(e){
      const duplicate=e?.code==='23505';
      res.status(duplicate?409:400).json({error:duplicate?'That promo code already exists for this restaurant.':e.message||'Unable to create promo code'});
    }
  });
  app.patch('/api/menu/coupons/:id', requireManager, async(req,res)=>{
    try{
      const b=clean(req.body.businessId),p=normalizeCoupon(req.body);
      const r=await pool.query(
        'update customer_coupons set code=$3,discount_type=$4,discount_value=$5,min_order_amount=$6,max_redemptions=$7,active=$8,starts_at=coalesce($9,starts_at),expires_at=$10 where id=$1 and business_id=$2 returning id,code,discount_type,discount_value,min_order_amount,max_redemptions,redeemed_count,active,starts_at,expires_at',
        [req.params.id,b,p.code,p.discountType,p.discountValue,p.minOrderAmount,p.maxRedemptions,p.active,p.startsAt,p.expiresAt]
      );
      if(!r.rowCount)return res.status(404).json({error:'Promo code not found'});
      broadcastRealtime({businessId:b,event:'promotion.updated',data:{type:'COUPON_UPDATED',coupon:r.rows[0]}});
      res.json(r.rows[0]);
    }catch(e){res.status(400).json({error:e.message||'Unable to update promo code'});}
  });
  app.post('/api/promotions/validate', async(req,res)=>{
    try{
      const b=clean(req.body.businessId),code=clean(req.body.code).toUpperCase(),subtotal=Number(req.body.subtotal);
      if(!b||!code||!Number.isFinite(subtotal)||subtotal<0)return res.status(400).json({error:'Business, promo code and subtotal are required'});
      const r=await pool.query(
        'select id,code,discount_type,discount_value,min_order_amount,max_redemptions,redeemed_count,starts_at,expires_at from customer_coupons where business_id=$1 and code=$2 and active=true and starts_at<=now() and (expires_at is null or expires_at>now())',
        [b,code]
      );
      if(!r.rowCount)return res.status(404).json({error:'Promo code is invalid or expired'});
      const p=r.rows[0];
      if(p.max_redemptions!==null && Number(p.redeemed_count)>=Number(p.max_redemptions))return res.status(409).json({error:'This promo code has reached its redemption limit'});
      if(subtotal<Number(p.min_order_amount))return res.status(400).json({error:'Minimum order for this promo is '+Number(p.min_order_amount).toLocaleString('en-KE')+' KES'});
      const discount=p.discount_type==='PERCENT'
        ? Math.min(subtotal,Math.round(subtotal*Number(p.discount_value)/100*100)/100)
        : Math.min(subtotal,Number(p.discount_value));
      res.json({valid:true,code:p.code,discountType:p.discount_type,discountValue:Number(p.discount_value),discount:Math.round(discount*100)/100,minOrderAmount:Number(p.min_order_amount),expiresAt:p.expires_at});
    }catch(e){res.status(500).json({error:e.message||'Unable to validate promo code'});}
  });
  app.post('/api/menu/promotions', requireManager, async(req,res)=>{try{const b=clean(req.body.businessId),p=normalizePromotion(req.body);if(!b||!p.name)return res.status(400).json({error:'Business and promotion name are required'});const r=await pool.query('insert into promotions(id,business_id,name,type,value,min_order_kes,starts_at,ends_at,days_of_week,start_time,end_time,active,banner_text,product_ids,category) values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *',[b,p.name,p.type,p.value,p.minOrder,p.startsAt,p.endsAt,p.daysOfWeek,p.startTime,p.endTime,p.active,p.bannerText||null,JSON.stringify(p.productIds),p.category]);broadcastRealtime({businessId:b,event:'promotion.updated',data:{type:'PROMOTION_CREATED',promotion:r.rows[0]}});res.status(201).json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||'Unable to create promotion'});}});
  app.patch('/api/menu/promotions/:id', requireManager, async(req,res)=>{try{const b=clean(req.body.businessId);const p=normalizePromotion(req.body);const r=await pool.query('update promotions set name=$3,type=$4,value=$5,min_order_kes=$6,starts_at=$7,ends_at=$8,days_of_week=$9,start_time=$10,end_time=$11,active=$12,banner_text=$13,product_ids=$14,category=$15,updated_at=now() where id=$1 and business_id=$2 returning *',[req.params.id,b,p.name,p.type,p.value,p.minOrder,p.startsAt,p.endsAt,p.daysOfWeek,p.startTime,p.endTime,p.active,p.bannerText||null,JSON.stringify(p.productIds),p.category]);if(!r.rowCount)return res.status(404).json({error:'Promotion not found'});broadcastRealtime({businessId:b,event:'promotion.updated',data:{type:'PROMOTION_UPDATED',promotion:r.rows[0]}});res.json(r.rows[0]);}catch(e){res.status(400).json({error:e.message||'Unable to update promotion'});}});
  app.post('/api/menu/categories/reorder', requireManager, async(req,res)=>{    const businessId=clean(req.body.businessId),orderedIds=Array.isArray(req.body.categoryIds)?req.body.categoryIds.map(clean):[];    if(!businessId||!orderedIds.length)return res.status(400).json({error:'Business and category order are required'});    if(new Set(orderedIds).size!==orderedIds.length)return res.status(400).json({error:'Category IDs must be unique'});    const client=await pool.connect();    try{      await client.query('begin');      const current=await client.query('select id from menu_categories where business_id=$1 order by sort_order,name for update',[businessId]);      const currentIds=current.rows.map(x=>String(x.id));      if(currentIds.length!==orderedIds.length||currentIds.some(id=>!orderedIds.includes(id)))throw new Error('Category order is out of date. Refresh and try again.');      for(let i=0;i<orderedIds.length;i++)await client.query('update menu_categories set sort_order=$1,updated_at=now() where id=$2 and business_id=$3',[i,orderedIds[i],businessId]);      await client.query('commit');      const result=await pool.query('select id,name,description,sort_order,active from menu_categories where business_id=$1 order by sort_order,name',[businessId]);      broadcastRealtime({businessId,event:'menu.updated',data:{type:'CATEGORIES_REORDERED',categories:result.rows}});      res.json({categories:result.rows});    }catch(e){try{await client.query('rollback')}catch{}res.status(400).json({error:e.message||'Unable to reorder categories'});}finally{client.release();}  });  app.get('/api/menu/public', async(req,res)=>{try{const b=clean(req.query.businessId);if(!b)return res.status(400).json({error:'businessId is required'});const [business,categories,products,promos]=await Promise.all([pool.query('select id,name,slug,logo_url,primary_color,domain,status,plan_key from businesses where id=$1',[b]),pool.query('select id,name,description,sort_order,active from menu_categories where business_id=$1 and active=true order by sort_order,name',[b]),pool.query('select p.id,p.name,p.category,p.category_id,p.description,p.price,p.image_url,p.hero_image_url,p.active,p.featured,p.options,coalesce(c.sort_order,999) as category_sort,coalesce(c.name,p.category) as category_name from products p left join menu_categories c on c.id=p.category_id where p.business_id=$1 and p.active=true order by category_sort,category_name,p.name',[b]),pool.query('select * from promotions where business_id=$1 and active=true and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()) order by created_at desc',[b])]);res.json({business:business.rows[0]||null,businessId:b,categories:categories.rows,products:products.rows,promotions:promos.rows});}catch(e){res.status(500).json({error:e.message||'Unable to load public menu'});}});
}