'use client';

import React, { useState } from 'react';
import { Treemap, ResponsiveContainer } from 'recharts';

// 지역명 매핑
const REGION_MAP: { [key: string]: string } = {
  '西北': '서북',
  '华东': '화동',
  '华南': '화남',
  '华北': '화북',
  '华中': '화중',
  '东北': '동북',
  '西南': '서남',
};

interface TierRegionTreemapProps {
  tierData: { tierName: string; salesPerShop: number; salesK: number; shopCnt: number; prevSalesPerShop: number; prevSalesK: number; prevShopCnt: number; yoy: number }[];
  regionData: { regionName: string; salesPerShop: number; salesK: number; shopCnt: number; prevSalesPerShop: number; prevSalesK: number; prevShopCnt: number; yoy: number }[];
  brandCode: string;
  ym: string;
  lastDt: string;
}

interface TreemapContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  value?: number;
  salesPerShop?: number;
  salesK?: number;
  shopCnt?: number;
  prevSalesPerShop?: number;
  prevSalesK?: number;
  prevShopCnt?: number;
  yoy?: number;
  color?: string;
  onClick?: () => void;
}

function TreemapContent(props: TreemapContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, salesPerShop, salesK, shopCnt, prevSalesPerShop, prevSalesK, prevShopCnt, yoy, color, onClick } = props;
  
  if (width < 100 || height < 80) {
    return (
      <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
        <rect x={x} y={y} width={width} height={height} fill={color || '#4F46E5'} stroke="#fff" strokeWidth={3} rx={8} />
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={16} fontWeight="bold">
          {name}
        </text>
      </g>
    );
  }
  
  const formatNum = (v: number) => Math.round(v).toLocaleString();
  const formatYoy = (v: number | undefined) => v ? `${((v - 1) * 100).toFixed(1)}%` : '-';
  
  return (
    <g onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <rect x={x} y={y} width={width} height={height} fill={color || '#4F46E5'} stroke="#fff" strokeWidth={3} rx={8} />
      <text x={x + 16} y={y + 28} fill="#fff" fontSize={18} fontWeight="bold">{name}</text>
      <text x={x + 16} y={y + 52} fill="#fff" fontSize={15} fontWeight="600">점당: {formatNum(salesPerShop || 0)}</text>
      <text x={x + 16} y={y + 72} fill="rgba(255,255,255,0.9)" fontSize={12}>[{formatNum(salesK || 0)}K, {shopCnt}개]</text>
      {height > 100 && (
        <>
          <text x={x + 16} y={y + 92} fill="rgba(255,255,255,0.85)" fontSize={11}>전년: {formatNum(prevSalesPerShop || 0)}</text>
          <text x={x + 16} y={y + 108} fill="rgba(255,255,255,0.75)" fontSize={10}>[{formatNum(prevSalesK || 0)}K, {prevShopCnt}개]</text>
        </>
      )}
      {height > 125 && (
        <text x={x + 16} y={y + 128} fill="#FCD34D" fontSize={13} fontWeight="bold">YOY: {formatYoy(yoy)}</text>
      )}
    </g>
  );
}

// 카테고리 트리맵 모달
function CategoryTreemapModal({
  isOpen,
  onClose,
  type,
  keyName,
  brandCode,
  ym,
  lastDt,
}: {
  isOpen: boolean;
  onClose: () => void;
  type: 'tier' | 'region';
  keyName: string;
  brandCode: string;
  ym: string;
  lastDt: string;
}) {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<{ category: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen && keyName) {
      fetchCategories();
    }
  }, [isOpen, keyName]);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type,
        key: keyName,
        brandCode,
        ym,
        lastDt,
      });
      const res = await fetch(`/api/category-sales?${params}`);
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error('카테고리 조회 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category);
  };

  const handleCloseProductModal = () => {
    setSelectedCategory(null);
  };

  if (!isOpen) return null;

  const treeData = categories.map((cat) => ({
    name: cat.category,
    size: cat.cySalesAmt,
    cySalesAmt: cat.cySalesAmt,
    pySalesAmt: cat.pySalesAmt,
    yoy: cat.yoy,
  }));

  const getColor = (index: number) => {
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444'];
    return colors[index % colors.length];
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-lg p-6 max-w-6xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">{keyName} - 카테고리별 판매</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-3xl font-bold">&times;</button>
          </div>
          
          {loading ? (
            <div className="text-center py-12">로딩 중...</div>
          ) : categories.length === 0 ? (
            <div className="text-center py-12 text-gray-500">데이터가 없습니다.</div>
          ) : (
            <div className="h-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={treeData}
                  dataKey="size"
                  aspectRatio={4 / 3}
                  stroke="#fff"
                  fill="#8884d8"
                  content={<CategoryTreemapContent colors={getColor} onClick={handleCategoryClick} />}
                />
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {selectedCategory && (
        <ProductSalesModal
          isOpen={!!selectedCategory}
          onClose={handleCloseProductModal}
          type={type}
          keyName={keyName}
          category={selectedCategory}
          brandCode={brandCode}
          ym={ym}
          lastDt={lastDt}
        />
      )}
    </>
  );
}

function CategoryTreemapContent({ colors, onClick }: { colors: (index: number) => string; onClick: (category: string) => void }): any {
  return function CustomContent(props: any): any {
    const { x, y, width, height, name, cySalesAmt, pySalesAmt, yoy, index } = props;
    
    const formatNum = (v: number) => (v / 1000).toFixed(0);
    const formatYoy = (v: number | null) => v ? `${((v - 1) * 100).toFixed(1)}%` : '-';
    
    const handleClick = () => {
      if (onClick) onClick(name);
    };
    
    if (width < 80 || height < 60) {
      return (
        <g onClick={handleClick} style={{ cursor: 'pointer' }}>
          <rect x={x} y={y} width={width} height={height} fill={colors(index)} stroke="#fff" strokeWidth={3} rx={8} />
          <text x={x + width / 2} y={y + height / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={14} fontWeight="bold">
            {name}
          </text>
        </g>
      );
    }
    
    return (
      <g onClick={handleClick} style={{ cursor: 'pointer' }}>
        <rect x={x} y={y} width={width} height={height} fill={colors(index)} stroke="#fff" strokeWidth={3} rx={8} />
        <text x={x + 12} y={y + 24} fill="#fff" fontSize={16} fontWeight="bold">{name}</text>
        <text x={x + 12} y={y + 46} fill="#fff" fontSize={13}>당년: {formatNum(cySalesAmt)}K</text>
        <text x={x + 12} y={y + 64} fill="rgba(255,255,255,0.9)" fontSize={12}>전년: {formatNum(pySalesAmt)}K</text>
        {height > 85 && (
          <text x={x + 12} y={y + 84} fill="#FCD34D" fontSize={12} fontWeight="bold">YOY: {formatYoy(yoy)}</text>
        )}
      </g>
    );
  };
}

// 상품별 내역 모달
function ProductSalesModal({
  isOpen,
  onClose,
  type,
  keyName,
  category,
  brandCode,
  ym,
  lastDt,
}: {
  isOpen: boolean;
  onClose: () => void;
  type: 'tier' | 'region';
  keyName: string;
  category: string;
  brandCode: string;
  ym: string;
  lastDt: string;
}) {
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<{ prdtCdScs: string; prdtNm: string; cySalesAmt: number; pySalesAmt: number; yoy: number | null }[]>([]);

  React.useEffect(() => {
    if (isOpen) {
      fetchProducts();
    }
  }, [isOpen]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type,
        key: keyName,
        category,
        brandCode,
        ym,
        lastDt,
      });
      const res = await fetch(`/api/product-sales?${params}`);
      const data = await res.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error('상품 조회 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white rounded-lg p-6 max-w-5xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{keyName} - {category} - 상품별 판매</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-3xl font-bold">&times;</button>
        </div>
        
        {loading ? (
          <div className="text-center py-8">로딩 중...</div>
        ) : products.length === 0 ? (
          <div className="text-center py-8 text-gray-500">데이터가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left">상품코드</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">상품명</th>
                  <th className="border border-gray-300 px-4 py-2 text-right">당년 판매(K)</th>
                  <th className="border border-gray-300 px-4 py-2 text-right">전년 판매(K)</th>
                  <th className="border border-gray-300 px-4 py-2 text-right">YOY</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-4 py-2">{p.prdtCdScs}</td>
                    <td className="border border-gray-300 px-4 py-2">{p.prdtNm}</td>
                    <td className="border border-gray-300 px-4 py-2 text-right">{(p.cySalesAmt / 1000).toFixed(0)}</td>
                    <td className="border border-gray-300 px-4 py-2 text-right">{(p.pySalesAmt / 1000).toFixed(0)}</td>
                    <td className="border border-gray-300 px-4 py-2 text-right">{p.yoy ? `${((p.yoy - 1) * 100).toFixed(1)}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TierRegionTreemap({ tierData, regionData, brandCode, ym, lastDt }: TierRegionTreemapProps) {
  const [activeTab, setActiveTab] = useState<'tier' | 'region'>('tier');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const currentData = activeTab === 'tier' ? tierData : regionData;
  
  const treeData = currentData.map((item) => {
    const name = activeTab === 'tier' 
      ? ('tierName' in item ? item.tierName : '') 
      : ('regionName' in item ? item.regionName : '');
    const displayName = activeTab === 'region' && REGION_MAP[name] ? `${REGION_MAP[name]}(${name})` : name;
    
    return {
      name: displayName,
      originalName: name,
      size: item.salesPerShop,
      salesPerShop: item.salesPerShop,
      salesK: item.salesK,
      shopCnt: item.shopCnt,
      prevSalesPerShop: item.prevSalesPerShop,
      prevSalesK: item.prevSalesK,
      prevShopCnt: item.prevShopCnt,
      yoy: item.yoy,
    };
  });

  const getColor = (index: number) => {
    const colors = ['#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#D97706', '#65A30D', '#059669', '#0891B2', '#0284C7'];
    return colors[index % colors.length];
  };

  const handleNodeClick = (data: any) => {
    setSelectedKey(data.originalName);
  };

  const handleCloseModal = () => {
    setSelectedKey(null);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">티어/지역별 점당매출 트리맵</h3>
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded ${activeTab === 'tier' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('tier')}
          >
            티어
          </button>
          <button
            className={`px-4 py-2 rounded ${activeTab === 'region' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
            onClick={() => setActiveTab('region')}
          >
            지역
          </button>
        </div>
      </div>

      <div className="h-[500px]">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treeData}
            dataKey="size"
            aspectRatio={4 / 3}
            stroke="#fff"
            fill="#8884d8"
            content={<CustomTreemapContent colors={getColor} onClick={handleNodeClick} />}
          />
        </ResponsiveContainer>
      </div>

      {selectedKey && (
        <CategoryTreemapModal
          isOpen={!!selectedKey}
          onClose={handleCloseModal}
          type={activeTab}
          keyName={selectedKey}
          brandCode={brandCode}
          ym={ym}
          lastDt={lastDt}
        />
      )}
    </div>
  );
}

function CustomTreemapContent({ colors, onClick }: { colors: (index: number) => string; onClick: (data: any) => void }): any {
  return function Content(props: any): any {
    const { depth, x, y, width, height, index, name, salesPerShop, salesK, shopCnt, prevSalesPerShop, prevSalesK, prevShopCnt, yoy, originalName } = props;
    
    const handleClick = () => {
      if (onClick) onClick({ originalName, name });
    };
    
    return (
      <TreemapContent
        x={x}
        y={y}
        width={width}
        height={height}
        name={name}
        salesPerShop={salesPerShop}
        salesK={salesK}
        shopCnt={shopCnt}
        prevSalesPerShop={prevSalesPerShop}
        prevSalesK={prevSalesK}
        prevShopCnt={prevShopCnt}
        yoy={yoy}
        color={colors(index)}
        onClick={handleClick}
      />
    );
  };
}

