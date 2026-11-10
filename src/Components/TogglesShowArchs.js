import React, { useState, useCallback } from 'react';
import { useShowArch } from "../context/ShowArchContext";


const THEME = {
  primary: '#6c757d',        
  primaryLight: '#adb5bd',   
  primaryDark: '#495057',    
  secondary: '#868e96',      
  success: '#51cf66',        
  warning: '#ffc078',        
  danger: '#ff8787',         
  dark: '#343a40',           
  light: '#f8f9fa',          
  border: '#e9ecef',         
  hover: '#f1f3f5',          
  white: '#ffffff',
  text: {
    primary: '#495057',      
    secondary: '#868e96',    
    muted: '#adb5bd',        
    light: '#f8f9fa'
  }
};


const GROUP_COLORS = {
  os: {
    base: {
      backgroundColor: '#f8f9fa', 
      borderColor: '#e9ecef',
      color: '#495057' 
    },
    selected: {
      backgroundColor: '#6c757d', 
      borderColor: '#495057',
      color: '#ffffff'
    },
    label: {
      color: '#6c757d',
      icon: '🖥️',
      bg: '#f1f3f5'
    }
  },
  cpu: {
    base: {
      backgroundColor: '#f8f9fa', 
      borderColor: '#e9ecef',
      color: '#495057' 
    },
    selected: {
      backgroundColor: '#6c757d', 
      borderColor: '#495057',
      color: '#ffffff'
    },
    label: {
      color: '#6c757d',
      icon: '⚡',
      bg: '#f1f3f5'
    }
  },
  compiler: {
    base: {
      backgroundColor: '#f8f9fa', 
      borderColor: '#e9ecef',
      color: '#495057' 
    },
    selected: {
      backgroundColor: '#6c757d', 
      borderColor: '#495057',
      color: '#ffffff'
    },
    label: {
      color: '#6c757d',
      icon: '⚙️',
      bg: '#f1f3f5'
    }
  }
};


const groupStyles = {
  container: {
    display: 'inline-flex',
    flexWrap: 'wrap',
    gap: '2px',
    background: 'transparent'
  },
  button: {
    padding: '4px 12px',
    fontSize: '0.8rem',
    fontWeight: 400,
    border: '1px solid',
    minWidth: 'auto',
    lineHeight: 1.5,
    cursor: 'pointer',
    outline: 'none',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    transition: 'all 0.1s ease',
    position: 'relative',
    zIndex: 1,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  firstButton: {
    borderTopLeftRadius: '20px',
    borderBottomLeftRadius: '20px',
    borderTopRightRadius: '4px',
    borderBottomRightRadius: '4px'
  },
  middleButton: {
    borderRadius: '4px'
  },
  lastButton: {
    borderTopLeftRadius: '4px',
    borderBottomLeftRadius: '4px',
    borderTopRightRadius: '20px',
    borderBottomRightRadius: '20px'
  },
  singleButton: {
    borderRadius: '20px'
  }
};


const labelStyles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '6px',
    background: '#f8f9fa',
    border: '1px solid #e9ecef',
    minWidth: '80px',
    boxShadow: 'none'
  },
  icon: {
    fontSize: '0.9rem',
    lineHeight: 1
  },
  text: {
    fontSize: '0.8rem',
    fontWeight: 500,
    letterSpacing: '0.2px',
    textTransform: 'uppercase' 
  },
  count: {
    fontSize: '0.65rem',
    padding: '2px 5px',
    borderRadius: '10px',
    background: '#ffffff',
    color: '#6c757d',
    fontWeight: 500,
    marginLeft: '4px',
    border: '1px solid #e9ecef'
  }
};

const TogglesShowArchs = ({ releaseQue, architectures, selection, onSelectionChange }) => {
    const { getAllArchsForQue, getActiveArchsForQue, setActiveArchs } = useShowArch();
    
    const archs = architectures || getAllArchsForQue(releaseQue);
    const activeArchs = selection || getActiveArchsForQue(releaseQue);

    // Use local state for immediate feedback
    const [localSelections, setLocalSelections] = useState({
        os: activeArchs.os || [],
        cpu: activeArchs.cpu || [],
        compiler: activeArchs.compiler || []
    });

    // Sync with context when it changes externally
    React.useEffect(() => {
        setLocalSelections({
            os: activeArchs.os || [],
            cpu: activeArchs.cpu || [],
            compiler: activeArchs.compiler || []
        });
    }, [activeArchs]);

    const handleButtonClick = useCallback((field, item, event) => {
        event.preventDefault();
        event.stopPropagation();
        
        const currentSelections = localSelections[field] || [];
        const isSelected = currentSelections.includes(item);
        
        let newSelections;
        if (isSelected) {
            newSelections = currentSelections.filter(v => v !== item);
        } else {
            newSelections = [...currentSelections, item];
        }
        
        // Update local state immediately for instant visual feedback
        setLocalSelections(prev => ({
            ...prev,
            [field]: newSelections
        }));
        
        // Update context
        if (onSelectionChange) {
            onSelectionChange({ ...localSelections, [field]: newSelections });
        } else {
            setActiveArchs({ field, activeValues: newSelections, releaseQue });
        }
    }, [localSelections, setActiveArchs, releaseQue, onSelectionChange]);

    const getButtonStyle = (index, total, isSelected, colors) => {
        let borderRadius = {};
        
        if (total === 1) {
            borderRadius = groupStyles.singleButton;
        } else if (index === 0) {
            borderRadius = groupStyles.firstButton;
        } else if (index === total - 1) {
            borderRadius = groupStyles.lastButton;
        } else {
            borderRadius = groupStyles.middleButton;
        }
        
        return {
            ...groupStyles.button,
            ...borderRadius,
            backgroundColor: isSelected ? colors.selected.backgroundColor : colors.base.backgroundColor,
            borderColor: isSelected ? colors.selected.borderColor : colors.base.borderColor,
            color: isSelected ? colors.selected.color : colors.base.color,
            fontWeight: isSelected ? 500 : 400,
            boxShadow: 'none',
            zIndex: isSelected ? 2 : 1,
            marginLeft: index > 0 ? '-1px' : '0'
        };
    };

    const renderButtonGroup = (title, field, items, colors) => {
        if (!items || items.length === 0) return null;
        
        const selections = localSelections[field] || [];
        const selectedCount = selections.length;
        
        return (
            <div className="d-flex flex-wrap align-items-center me-3" role="group" aria-label={title}>
                {/* Subtle Label */}
                <div style={labelStyles.container} className="me-2">
                    <span style={{ ...labelStyles.icon, color: colors.label.color }}>
                        {colors.label.icon}
                    </span>
                    <span style={{ ...labelStyles.text, color: THEME.text.primary }}>
                        {title}
                    </span>
                    {selectedCount > 0 && (
                        <span style={labelStyles.count}>
                            {selectedCount}
                        </span>
                    )}
                </div>

                {/* Grouped Buttons - Subtle */}
                <div style={groupStyles.container}>
                    {items.map((item, index) => {
                        const isSelected = selections.includes(item);
                        return (
                            <button
                                key={item}
                                type="button"
                                onClick={(e) => handleButtonClick(field, item, e)}
                                style={getButtonStyle(index, items.length, isSelected, colors)}
                                className="btn btn-sm"
                                aria-pressed={isSelected}
                                onMouseEnter={(e) => {
                                    if (!isSelected) {
                                        e.currentTarget.style.backgroundColor = '#f1f3f5';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isSelected) {
                                        e.currentTarget.style.backgroundColor = colors.base.backgroundColor;
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    } else {
                                        e.currentTarget.style.backgroundColor = colors.selected.backgroundColor;
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }
                                }}
                            >
                                {item}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className="d-flex flex-wrap align-items-center" style={{ gap: '12px' }}>
            {renderButtonGroup('OS', 'os', archs.os, GROUP_COLORS.os)}
            {renderButtonGroup('CPU', 'cpu', archs.cpu, GROUP_COLORS.cpu)}
            {renderButtonGroup('COMPILER', 'compiler', archs.compiler, GROUP_COLORS.compiler)}
        </div>
    );
};

export default TogglesShowArchs;